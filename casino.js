const fs = require("fs");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  SlashCommandBuilder,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const { hasEnough, removeFunds, addFunds, formatEuro } = require("./bank");

const CASINO_CHANNEL_ID = "1527054335928827954";
const FONDATION_ROLE_ID = "1509974377267990659";

const STATE_FILE = getStatePath("casino-state.json");
const JACKPOT_SEED = 1000;
const SLOT_RAKE = 0.03;
const ROULETTE_RAKE = 0.03;
const DUEL_RAKE = 0.05;
const DUEL_TIMEOUT_MS = 5 * 60 * 1000;

const SYMBOLS = [
  { emoji: "🍒", weight: 30, multiplier: 1.5 },
  { emoji: "🍋", weight: 25, multiplier: 2 },
  { emoji: "🔔", weight: 20, multiplier: 3 },
  { emoji: "⭐", weight: 15, multiplier: 5 },
  { emoji: "💎", weight: 8, multiplier: 10 },
  { emoji: "7️⃣", weight: 2, multiplier: "JACKPOT" },
];

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const BTN = {
  SLOTS: "casino_slots",
  ROULETTE: "casino_roulette",
  DUEL: "casino_duel",
};
const ROULETTE_COLOR_PREFIX = "casino_roulette_color_";
const MODAL_SLOTS = "casino_modal_slots";
const MODAL_ROULETTE_PREFIX = "casino_modal_roulette_";
const MODAL_DUEL_PREFIX = "casino_modal_duel_";
const SELECT_DUEL_OPPONENT = "casino_select_opponent";
const DUEL_ACCEPT_PREFIX = "casino_duel_accept_";
const DUEL_DECLINE_PREFIX = "casino_duel_decline_";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (typeof data.jackpot !== "number") data.jackpot = JACKPOT_SEED;
    if (!Array.isArray(data.duels)) data.duels = [];
    return data;
  } catch {
    return { messageId: null, jackpot: JACKPOT_SEED, duels: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("casino-state.json");
}

function parseAmount(str) {
  return parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function pickWeightedSymbol() {
  const total = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let roll = Math.random() * total;
  for (const sym of SYMBOLS) {
    if (roll < sym.weight) return sym;
    roll -= sym.weight;
  }
  return SYMBOLS[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCasinoEmbed(state) {
  return new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🎰 Casino de la Maison")
    .setDescription(
      "Bienvenue au casino ! Votre solde vient de **`/bank`**.\n\n" +
        "🎰 **Machine à sous** — 3 symboles, plus rare = plus gros gain. Trois 7️⃣ font tomber le **jackpot** !\n" +
        "🎡 **Roulette** — Rouge/Noir (x2) ou Vert (x14).\n" +
        "⚔️ **Défi** — Misez directement contre un autre membre, le gagnant rafle la mise (moins la taxe de la maison).\n\n" +
        "*Chaque mise sur la machine à sous et la roulette alimente le jackpot progressif.*"
    )
    .addFields({
      name: "💰 Jackpot progressif",
      value: `**${formatEuro(state.jackpot)}**`,
    })
    .setFooter({ text: "Jouez responsable — c'est pour le fun 🎲" })
    .setTimestamp();
}

function buildCasinoComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.SLOTS)
        .setLabel("Machine à sous")
        .setEmoji("🎰")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BTN.ROULETTE)
        .setLabel("Roulette")
        .setEmoji("🎡")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BTN.DUEL)
        .setLabel("Défier un membre")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function updateCasinoMessage(client, state) {
  const channel = await client.channels.fetch(CASINO_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = buildCasinoEmbed(state);
  const components = buildCasinoComponents();

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }

  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const candidates = messages?.filter(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === "🎰 Casino de la Maison"
    );
    if (candidates?.size) {
      const sorted = [...candidates.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      msg = sorted[0];
      for (const dup of sorted.slice(1)) {
        await dup.delete().catch(() => null);
      }
    }
  }

  if (msg) {
    await msg.edit({ embeds: [embed], components });
    state.messageId = msg.id;
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    state.messageId = sent.id;
  }
  saveState(state);
}

async function setupCasinoPanel(client) {
  const state = loadState();
  await updateCasinoMessage(client, state);
}

function buildAmountModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("montant")
          .setLabel("Montant à miser (€)")
          .setPlaceholder("Ex. 50")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildRouletteColorRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}rouge`)
      .setLabel("Rouge (x2)")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}noir`)
      .setLabel("Noir (x2)")
      .setEmoji("⚫")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}vert`)
      .setLabel("Vert (x14)")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success)
  );
}

async function playSlots(interaction, client, amount) {
  const state = loadState();

  if (!hasEnough(interaction.user.id, amount)) {
    await interaction.editReply({ content: "❌ Solde insuffisant. Vérifiez `/bank`." });
    return;
  }

  removeFunds(interaction.user.id, amount);
  state.jackpot = round2(state.jackpot + amount * SLOT_RAKE);
  saveState(state);

  await interaction.editReply({ content: "🎰 [ ❓ | ❓ | ❓ ] — Ça tourne…" });
  await sleep(900);

  const reels = [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()];
  await interaction.editReply({
    content: `🎰 [ ${reels[0].emoji} | ❓ | ❓ ] — Ça tourne…`,
  });
  await sleep(900);
  await interaction.editReply({
    content: `🎰 [ ${reels[0].emoji} | ${reels[1].emoji} | ❓ ] — Ça tourne…`,
  });
  await sleep(900);

  const allSame = reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji;
  const twoSame =
    reels[0].emoji === reels[1].emoji ||
    reels[1].emoji === reels[2].emoji ||
    reels[0].emoji === reels[2].emoji;

  let resultText;

  if (allSame && reels[0].multiplier === "JACKPOT") {
    const won = state.jackpot;
    addFunds(interaction.user.id, won);
    state.jackpot = JACKPOT_SEED;
    saveState(state);
    await updateCasinoMessage(client, state);
    resultText =
      `🎰 [ ${reels.map((r) => r.emoji).join(" | ")} ]\n\n` +
      `💥🎉 **JACKPOT !!!** 🎉💥\nVous remportez **${formatEuro(won)}** !`;
  } else if (allSame) {
    const won = round2(amount * reels[0].multiplier);
    addFunds(interaction.user.id, won);
    resultText =
      `🎰 [ ${reels.map((r) => r.emoji).join(" | ")} ]\n\n` +
      `✅ Trois **${reels[0].emoji}** ! Vous gagnez **${formatEuro(won)}** (x${reels[0].multiplier}).`;
  } else if (twoSame) {
    addFunds(interaction.user.id, amount);
    resultText =
      `🎰 [ ${reels.map((r) => r.emoji).join(" | ")} ]\n\n` +
      `➖ Paire ! Mise remboursée (${formatEuro(amount)}).`;
  } else {
    resultText =
      `🎰 [ ${reels.map((r) => r.emoji).join(" | ")} ]\n\n` +
      `❌ Perdu. Mise : ${formatEuro(amount)}.`;
  }

  await updateCasinoMessage(client, loadState());
  await interaction.editReply({ content: resultText });
}

async function playRoulette(interaction, client, color, amount) {
  const state = loadState();

  if (!hasEnough(interaction.user.id, amount)) {
    await interaction.editReply({ content: "❌ Solde insuffisant. Vérifiez `/bank`." });
    return;
  }

  removeFunds(interaction.user.id, amount);
  state.jackpot = round2(state.jackpot + amount * ROULETTE_RAKE);
  saveState(state);

  await interaction.editReply({ content: "🎡 La bille tourne…" });
  await sleep(1200);

  const number = Math.floor(Math.random() * 37);
  const resultColor = number === 0 ? "vert" : RED_NUMBERS.has(number) ? "rouge" : "noir";
  const colorEmoji = { rouge: "🔴", noir: "⚫", vert: "🟢" };
  const multiplier = { rouge: 2, noir: 2, vert: 14 }[color];

  let resultText;
  if (color === resultColor) {
    const won = round2(amount * multiplier);
    addFunds(interaction.user.id, won);
    resultText =
      `🎡 La bille s'arrête sur **${number}** ${colorEmoji[resultColor]}\n\n` +
      `✅ Gagné ! Vous remportez **${formatEuro(won)}** (x${multiplier}).`;
  } else {
    resultText =
      `🎡 La bille s'arrête sur **${number}** ${colorEmoji[resultColor]}\n\n` +
      `❌ Perdu. Mise : ${formatEuro(amount)}.`;
  }

  await updateCasinoMessage(client, loadState());
  await interaction.editReply({ content: resultText });
}

function buildDuelChallengeEmbed(duel) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("⚔️ Défi lancé !")
    .setDescription(
      `<@${duel.challengerId}> défie <@${duel.opponentId}> pour **${formatEuro(duel.amount)}** chacun.\n\n` +
        `Le gagnant remporte **${formatEuro(round2(duel.amount * 2 * (1 - DUEL_RAKE)))}** (taxe de la maison : ${(DUEL_RAKE * 100).toFixed(0)}%).`
    )
    .setFooter({ text: `Expire dans 5 minutes • Réf. ${duel.id}` })
    .setTimestamp();
}

function buildDuelRow(duelId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUEL_ACCEPT_PREFIX}${duelId}`)
      .setLabel("Accepter")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${DUEL_DECLINE_PREFIX}${duelId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

async function handleCasinoInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "casino-setup") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut publier le panel casino.`,
        ephemeral: true,
      });
      return true;
    }
    await setupCasinoPanel(client);
    await interaction.reply({
      content: `✅ Panel casino publié dans <#${CASINO_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton()) {
    if (interaction.customId === BTN.SLOTS) {
      await interaction.showModal(buildAmountModal(MODAL_SLOTS, "🎰 Machine à sous"));
      return true;
    }

    if (interaction.customId === BTN.ROULETTE) {
      await interaction.reply({
        content: "🎡 Choisissez votre couleur :",
        components: [buildRouletteColorRow()],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith(ROULETTE_COLOR_PREFIX)) {
      const color = interaction.customId.slice(ROULETTE_COLOR_PREFIX.length);
      await interaction.showModal(
        buildAmountModal(`${MODAL_ROULETTE_PREFIX}${color}`, `🎡 Roulette — ${color}`)
      );
      return true;
    }

    if (interaction.customId === BTN.DUEL) {
      await interaction.reply({
        content: "⚔️ Choisissez qui vous voulez défier :",
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(SELECT_DUEL_OPPONENT)
              .setPlaceholder("Choisir un adversaire")
              .setMinValues(1)
              .setMaxValues(1)
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith(DUEL_ACCEPT_PREFIX)) {
      const duelId = interaction.customId.slice(DUEL_ACCEPT_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "pending") {
        await interaction.reply({ content: "❌ Ce défi n'est plus disponible.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.opponentId) {
        await interaction.reply({
          content: "❌ Seul le membre défié peut accepter.",
          ephemeral: true,
        });
        return true;
      }
      if (!hasEnough(duel.challengerId, duel.amount) || !hasEnough(duel.opponentId, duel.amount)) {
        await interaction.reply({
          content: "❌ L'un des deux joueurs n'a plus assez de solde. Défi annulé.",
          ephemeral: true,
        });
        duel.status = "cancelled";
        saveState(state);
        await interaction.message.edit({ components: [buildDuelRow(duelId, true)] }).catch(() => null);
        return true;
      }

      removeFunds(duel.challengerId, duel.amount);
      removeFunds(duel.opponentId, duel.amount);

      const pot = duel.amount * 2;
      const rake = round2(pot * DUEL_RAKE);
      const payout = round2(pot - rake);

      const winnerId = Math.random() < 0.5 ? duel.challengerId : duel.opponentId;
      const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;

      addFunds(winnerId, payout);

      const casinoState = loadState();
      casinoState.jackpot = round2(casinoState.jackpot + rake);
      duel.status = "resolved";
      duel.winnerId = winnerId;
      duel.resolvedAt = Date.now();
      const idx = casinoState.duels.findIndex((d) => d.id === duelId);
      if (idx !== -1) casinoState.duels[idx] = duel;
      saveState(casinoState);
      await updateCasinoMessage(client, casinoState);

      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("⚔️ Résultat du défi")
        .setDescription(
          `🪙 Pile ou face...\n\n` +
            `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !\n` +
            `😔 <@${loserId}> repart bredouille.`
        )
        .setTimestamp();

      await interaction.update({ embeds: [resultEmbed], content: "", components: [] });
      return true;
    }

    if (interaction.customId.startsWith(DUEL_DECLINE_PREFIX)) {
      const duelId = interaction.customId.slice(DUEL_DECLINE_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "pending") {
        await interaction.reply({ content: "❌ Ce défi n'est plus disponible.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.opponentId) {
        await interaction.reply({
          content: "❌ Seul le membre défié peut refuser.",
          ephemeral: true,
        });
        return true;
      }

      duel.status = "declined";
      saveState(state);

      await interaction.update({
        content: `❌ <@${duel.opponentId}> a refusé le défi de <@${duel.challengerId}>.`,
        embeds: [],
        components: [],
      });
      return true;
    }
  }

  if (interaction.isUserSelectMenu() && interaction.customId === SELECT_DUEL_OPPONENT) {
    const opponentId = interaction.users.first()?.id;

    if (!opponentId) {
      await interaction.update({ content: "❌ Sélection invalide.", components: [] });
      return true;
    }
    if (opponentId === interaction.user.id) {
      await interaction.update({
        content: "❌ Vous ne pouvez pas vous défier vous-même.",
        components: [],
      });
      return true;
    }
    const opponent = await interaction.guild.members.fetch(opponentId).catch(() => null);
    if (opponent?.user.bot) {
      await interaction.update({ content: "❌ Vous ne pouvez pas défier un bot.", components: [] });
      return true;
    }

    await interaction.showModal(buildAmountModal(`${MODAL_DUEL_PREFIX}${opponentId}`, "⚔️ Montant du défi"));
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === MODAL_SLOTS) {
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      await playSlots(interaction, client, amount);
      return true;
    }

    if (interaction.customId.startsWith(MODAL_ROULETTE_PREFIX)) {
      const color = interaction.customId.slice(MODAL_ROULETTE_PREFIX.length);
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      await playRoulette(interaction, client, color, amount);
      return true;
    }

    if (interaction.customId.startsWith(MODAL_DUEL_PREFIX)) {
      const opponentId = interaction.customId.slice(MODAL_DUEL_PREFIX.length);
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));

      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      if (!hasEnough(interaction.user.id, amount)) {
        await interaction.reply({ content: "❌ Solde insuffisant. Vérifiez `/bank`.", ephemeral: true });
        return true;
      }

      const state = loadState();
      const duel = {
        id: `duel_${Date.now()}`,
        challengerId: interaction.user.id,
        opponentId,
        amount,
        status: "pending",
        createdAt: Date.now(),
      };
      state.duels.push(duel);
      saveState(state);

      const channel = await interaction.guild.channels.fetch(CASINO_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({
          content: `<@${opponentId}>`,
          embeds: [buildDuelChallengeEmbed(duel)],
          components: [buildDuelRow(duel.id)],
        });
      }

      setTimeout(() => {
        const s = loadState();
        const d = s.duels.find((x) => x.id === duel.id);
        if (d && d.status === "pending") {
          d.status = "expired";
          saveState(s);
        }
      }, DUEL_TIMEOUT_MS);

      await interaction.reply({
        content: `✅ Défi envoyé à <@${opponentId}> pour **${formatEuro(amount)}** dans <#${CASINO_CHANNEL_ID}>.`,
        ephemeral: true,
      });
      return true;
    }
  }

  return false;
}

function registerCasinoCommand() {
  return new SlashCommandBuilder()
    .setName("casino-setup")
    .setDescription("Publier le panel du casino (Fondation uniquement)")
    .toJSON();
}

module.exports = {
  setupCasinoPanel,
  handleCasinoInteraction,
  registerCasinoCommand,
  CASINO_CHANNEL_ID,
};
