const fs = require("fs");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const { hasEnough, removeFunds, addFunds, formatEuro } = require("./bank");

const PARIS_EVENT_CHANNEL_ID = "1527054621426581594";
const FONDATION_ROLE_ID = "1509974377267990659";

const STATE_FILE = getStatePath("paris-state.json");

const MATCH = {
  id: "esp_arg_2026_final",
  competition: "Coupe du Monde 2026 • Finale",
  teamA: "Espagne",
  teamB: "Argentine",
  emojiA: "🇪🇸",
  emojiB: "🇦🇷",
  oddsA: 2.2,
  oddsDraw: 3.0,
  oddsB: 3.4,
  schedule: "Dim. 21:00",
};

const BTN = {
  BET_A: "paris_bet_A",
  BET_DRAW: "paris_bet_draw",
  BET_B: "paris_bet_B",
  CLOSE: "paris_close",
  DECLARE: "paris_declare",
};
const SELECT = { RESULT: "paris_select_result" };
const MODAL_PREFIX = "paris_modal_";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.bets)) data.bets = [];
    return data;
  } catch {
    return {
      messageId: null,
      status: "open",
      result: null,
      bets: [],
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("paris-state.json");
}

function oddsFor(choice) {
  if (choice === "A") return MATCH.oddsA;
  if (choice === "draw") return MATCH.oddsDraw;
  return MATCH.oddsB;
}

function labelFor(choice) {
  if (choice === "A") return `${MATCH.emojiA} ${MATCH.teamA}`;
  if (choice === "draw") return "🤝 Match nul";
  return `${MATCH.emojiB} ${MATCH.teamB}`;
}

function getUserBet(state, userId) {
  return state.bets.find((b) => b.userId === userId);
}

function buildMatchEmbed(state) {
  const totalBets = state.bets.length;
  const totalStaked = state.bets.reduce((s, b) => s + b.amount, 0);

  const embed = new EmbedBuilder()
    .setColor(0x3ea6ff)
    .setTitle(`⚽ ${MATCH.competition}`)
    .setDescription(
      `${MATCH.emojiA} **${MATCH.teamA}**  🆚  **${MATCH.teamB}** ${MATCH.emojiB}\n` +
        `🕒 ${MATCH.schedule}`
    )
    .addFields(
      { name: `${MATCH.emojiA} ${MATCH.teamA}`, value: `Cote **${MATCH.oddsA.toFixed(2)}**`, inline: true },
      { name: "🤝 Match nul", value: `Cote **${MATCH.oddsDraw.toFixed(2)}**`, inline: true },
      { name: `${MATCH.emojiB} ${MATCH.teamB}`, value: `Cote **${MATCH.oddsB.toFixed(2)}**`, inline: true },
      { name: "Paris placés", value: `${totalBets}`, inline: true },
      { name: "Total misé", value: formatEuro(totalStaked), inline: true }
    )
    .setFooter({
      text:
        state.status === "open"
          ? "Placez votre mise avec les boutons ci-dessous • Solde via /bank"
          : state.result
            ? `Résultat déclaré : ${labelFor(state.result)}`
            : "Paris clos — en attente du résultat",
    })
    .setTimestamp();

  if (state.result) {
    embed.setColor(0x2ecc71);
  } else if (state.status === "closed") {
    embed.setColor(0x95a5a6);
  }

  return embed;
}

function buildMatchComponents(state) {
  const bettingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.BET_A)
      .setLabel(`${MATCH.teamA} (${MATCH.oddsA.toFixed(2)})`)
      .setEmoji(MATCH.emojiA)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.status !== "open"),
    new ButtonBuilder()
      .setCustomId(BTN.BET_DRAW)
      .setLabel(`Nul (${MATCH.oddsDraw.toFixed(2)})`)
      .setEmoji("🤝")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.status !== "open"),
    new ButtonBuilder()
      .setCustomId(BTN.BET_B)
      .setLabel(`${MATCH.teamB} (${MATCH.oddsB.toFixed(2)})`)
      .setEmoji(MATCH.emojiB)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(state.status !== "open")
  );

  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.CLOSE)
      .setLabel("Clore les paris")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.status !== "open"),
    new ButtonBuilder()
      .setCustomId(BTN.DECLARE)
      .setLabel("Déclarer le résultat")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(Boolean(state.result))
  );

  return [bettingRow, adminRow];
}

function buildStakeModal(choice) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${choice}`)
    .setTitle(`Mise — ${labelFor(choice)}`)
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

function buildResultSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.RESULT)
      .setPlaceholder("Quel est le résultat final ?")
      .addOptions(
        { label: `Victoire ${MATCH.teamA}`, value: "A", emoji: MATCH.emojiA },
        { label: "Match nul", value: "draw", emoji: "🤝" },
        { label: `Victoire ${MATCH.teamB}`, value: "B", emoji: MATCH.emojiB }
      )
  );
}

function parseAmount(str) {
  return parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
}

async function updateMatchMessage(client, state) {
  const channel = await client.channels.fetch(PARIS_EVENT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = buildMatchEmbed(state);
  const components = buildMatchComponents(state);

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }

  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const candidates = messages?.filter(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === `⚽ ${MATCH.competition}`
    );

    if (candidates?.size) {
      const sorted = [...candidates.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      msg = sorted[0];

      const duplicates = sorted.slice(1);
      for (const dup of duplicates) {
        await dup.delete().catch(() => null);
      }
    }
  }

  if (msg) {
    await msg.edit({ embeds: [embed], components });
    state.messageId = msg.id;
    saveState(state);
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    state.messageId = sent.id;
    saveState(state);
  }
}

async function setupParisPanel(client) {
  const state = loadState();
  await updateMatchMessage(client, state);
}

async function handleParisInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "pari-setup") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut publier le panel de paris.`,
        ephemeral: true,
      });
      return true;
    }

    await setupParisPanel(client);
    await interaction.reply({
      content: `✅ Panel de paris publié dans <#${PARIS_EVENT_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton()) {
    if ([BTN.BET_A, BTN.BET_DRAW, BTN.BET_B].includes(interaction.customId)) {
      const state = loadState();
      if (state.status !== "open") {
        await interaction.reply({
          content: "❌ Les paris sont clos pour ce match.",
          ephemeral: true,
        });
        return true;
      }

      if (getUserBet(state, interaction.user.id)) {
        await interaction.reply({
          content: "❌ Vous avez déjà placé un pari sur ce match.",
          ephemeral: true,
        });
        return true;
      }

      const choice =
        interaction.customId === BTN.BET_A
          ? "A"
          : interaction.customId === BTN.BET_DRAW
            ? "draw"
            : "B";

      await interaction.showModal(buildStakeModal(choice));
      return true;
    }

    if (interaction.customId === BTN.CLOSE) {
      if (!isFondation(interaction.member)) {
        await interaction.reply({
          content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut clore les paris.`,
          ephemeral: true,
        });
        return true;
      }

      const state = loadState();
      state.status = "closed";
      saveState(state);
      await updateMatchMessage(client, state);
      await interaction.reply({ content: "🔒 Paris clos.", ephemeral: true });
      return true;
    }

    if (interaction.customId === BTN.DECLARE) {
      if (!isFondation(interaction.member)) {
        await interaction.reply({
          content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut déclarer le résultat.`,
          ephemeral: true,
        });
        return true;
      }

      const state = loadState();
      if (state.result) {
        await interaction.reply({
          content: "ℹ️ Le résultat a déjà été déclaré.",
          ephemeral: true,
        });
        return true;
      }

      await interaction.reply({
        content: "🏁 Sélectionnez le résultat final :",
        components: [buildResultSelect()],
        ephemeral: true,
      });
      return true;
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT.RESULT) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut déclarer le résultat.`,
        ephemeral: true,
      });
      return true;
    }

    const state = loadState();
    if (state.result) {
      await interaction.update({
        content: "ℹ️ Le résultat a déjà été déclaré.",
        components: [],
      });
      return true;
    }

    const result = interaction.values[0];
    state.result = result;
    state.status = "closed";

    const winners = state.bets.filter((b) => b.choice === result);
    const payouts = [];

    for (const bet of winners) {
      const payout = Math.round(bet.amount * bet.odds * 100) / 100;
      addFunds(bet.userId, payout);
      payouts.push({ userId: bet.userId, payout });

      const user = await interaction.client.users.fetch(bet.userId).catch(() => null);
      if (user) {
        await user
          .send(
            `🏆 Votre pari sur **${labelFor(result)}** (${MATCH.teamA} vs ${MATCH.teamB}) est **gagnant** !\n` +
              `Mise : ${formatEuro(bet.amount)} • Cote ${bet.odds.toFixed(2)} • Gain : **${formatEuro(payout)}**`
          )
          .catch(() => null);
      }
    }

    const losers = state.bets.filter((b) => b.choice !== result);
    for (const bet of losers) {
      const user = await interaction.client.users.fetch(bet.userId).catch(() => null);
      if (user) {
        await user
          .send(
            `❌ Votre pari sur **${labelFor(bet.choice)}** (${MATCH.teamA} vs ${MATCH.teamB}) est **perdant**.\n` +
              `Résultat : ${labelFor(result)}.`
          )
          .catch(() => null);
      }
    }

    saveState(state);
    await updateMatchMessage(client, state);

    const summary = winners.length
      ? winners
          .map((b) => `<@${b.userId}> — mise ${formatEuro(b.amount)} → gain **${formatEuro(Math.round(b.amount * b.odds * 100) / 100)}**`)
          .join("\n")
      : "*Aucun gagnant.*";

    await interaction.update({
      content: `🏁 Résultat déclaré : **${labelFor(result)}**\n\n**Gagnants :**\n${summary}`.slice(0, 2000),
      components: [],
    });
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(MODAL_PREFIX)
  ) {
    const choice = interaction.customId.slice(MODAL_PREFIX.length);
    const amount = parseAmount(interaction.fields.getTextInputValue("montant"));

    if (!amount || amount <= 0 || Number.isNaN(amount)) {
      await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
      return true;
    }

    const state = loadState();
    if (state.status !== "open") {
      await interaction.reply({
        content: "❌ Les paris sont clos pour ce match.",
        ephemeral: true,
      });
      return true;
    }

    if (getUserBet(state, interaction.user.id)) {
      await interaction.reply({
        content: "❌ Vous avez déjà placé un pari sur ce match.",
        ephemeral: true,
      });
      return true;
    }

    if (!hasEnough(interaction.user.id, amount)) {
      await interaction.reply({
        content: "❌ Solde insuffisant. Vérifiez votre solde avec `/bank`.",
        ephemeral: true,
      });
      return true;
    }

    removeFunds(interaction.user.id, amount);

    const odds = oddsFor(choice);
    state.bets.push({
      userId: interaction.user.id,
      choice,
      amount,
      odds,
      placedAt: Date.now(),
    });
    saveState(state);
    await updateMatchMessage(client, state);

    const potentialPayout = Math.round(amount * odds * 100) / 100;
    await interaction.reply({
      content:
        `✅ Pari placé sur **${labelFor(choice)}** : ${formatEuro(amount)} à la cote **${odds.toFixed(2)}**.\n` +
        `Gain potentiel : **${formatEuro(potentialPayout)}**.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

function registerParisCommand() {
  return new SlashCommandBuilder()
    .setName("pari-setup")
    .setDescription("Publier le panel de paris Espagne - Argentine (Fondation uniquement)")
    .toJSON();
}

module.exports = {
  setupParisPanel,
  handleParisInteraction,
  registerParisCommand,
  PARIS_EVENT_CHANNEL_ID,
};
