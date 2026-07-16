const fs = require("fs");
const cron = require("node-cron");
const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");

const STATE_FILE = getStatePath("bank-state.json");
const DEFAULT_BALANCE = 500;
const TAX_RATE = 0.25;
const TRANSACTION_LOG_CHANNEL_ID = "1510687492896981102";
const FONDATION_ROLE_ID = "1509974377267990659";
const RICHEST_CHANNEL_ID = "1510702663535296623";
const RICHEST_TOP = 5;
const RICHEST_TITLE = "💰 Classement — Les plus riches";
const BTN_REFRESH_RICHEST = "bank_refresh_richest";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.balances || typeof data.balances !== "object") data.balances = {};
    if (data.richestMessageId === undefined) data.richestMessageId = null;
    return data;
  } catch {
    return { balances: {}, richestMessageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("bank-state.json");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

/** Applique la taxe de la maison (25%) sur un montant brut. */
function applyTax(grossAmount) {
  const tax = round2(grossAmount * TAX_RATE);
  const net = round2(grossAmount - tax);
  return { gross: round2(grossAmount), tax, net };
}

/** Crée le compte avec le solde de départ s'il n'existe pas encore. */
function ensureAccount(state, userId) {
  if (typeof state.balances[userId] !== "number") {
    state.balances[userId] = DEFAULT_BALANCE;
  }
  return state.balances[userId];
}

function getBalance(userId) {
  const state = loadState();
  const balance = ensureAccount(state, userId);
  saveState(state);
  return balance;
}

/** amount peut être négatif pour retirer. Renvoie le nouveau solde. */
function addFunds(userId, amount) {
  const state = loadState();
  ensureAccount(state, userId);
  state.balances[userId] = round2(state.balances[userId] + amount);
  saveState(state);
  return state.balances[userId];
}

function removeFunds(userId, amount) {
  return addFunds(userId, -amount);
}

function hasEnough(userId, amount) {
  return getBalance(userId) >= amount;
}

function buildBalanceEmbed(user, balance) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏦 Votre compte")
    .setDescription(`**${user.username}**\nSolde actuel : **${formatEuro(balance)}**`)
    .setFooter({ text: "Utilisable pour les paris sportifs et le casino" })
    .setTimestamp();
}

/** Log générique d'une transaction taxée, envoyé dans le salon de logs. */
async function logTransaction(client, { type, from, to, gross, tax, net }) {
  const channel = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("💸 Transaction")
    .addFields(
      { name: "Type", value: type, inline: true },
      { name: "Montant brut", value: formatEuro(gross), inline: true },
      { name: "Taxe (25%)", value: formatEuro(tax), inline: true },
      { name: "Montant net", value: formatEuro(net), inline: true },
      ...(from ? [{ name: "De", value: `<@${from}>`, inline: true }] : []),
      ...(to ? [{ name: "À", value: `<@${to}>`, inline: true }] : [])
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function handleBankInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "bank") {
    const balance = getBalance(interaction.user.id);
    await interaction.reply({
      embeds: [buildBalanceEmbed(interaction.user, balance)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "addmoney") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/addmoney\`.`,
        ephemeral: true,
      });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const newBalance = addFunds(target.id, amount);

    await logTransaction(client, {
      type: "🏦 Ajout manuel (/addmoney)",
      from: interaction.user.id,
      to: target.id,
      gross: amount,
      tax: 0,
      net: amount,
    });

    await interaction.reply({
      content: `✅ **${formatEuro(amount)}** ajoutés au compte de ${target} (nouveau solde : **${formatEuro(newBalance)}**).`,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "delbank") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/delbank\`.`,
        ephemeral: true,
      });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const current = getBalance(target.id);
    const toRemove = Math.min(amount, current); // ne descend jamais sous 0
    const newBalance = removeFunds(target.id, toRemove);

    await logTransaction(client, {
      type: "🏦 Retrait manuel (/delbank)",
      from: target.id,
      to: interaction.user.id,
      gross: toRemove,
      tax: 0,
      net: toRemove,
    });

    await interaction.reply({
      content:
        `✅ **${formatEuro(toRemove)}** retirés du compte de ${target} (nouveau solde : **${formatEuro(newBalance)}**).` +
        (toRemove < amount ? `\n⚠️ Le solde ne pouvait pas descendre sous 0, seul ${formatEuro(toRemove)} a été retiré.` : ""),
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === BTN_REFRESH_RICHEST) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut forcer l'actualisation.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();
    await interaction.guild.members.fetch().catch(() => null);

    const state = loadState();
    const embed = buildRichestEmbed(interaction.guild, state);

    await interaction.editReply({ embeds: [embed], components: [buildRichestRefreshRow()] });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "classement-setup") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut republier le classement.`,
        ephemeral: true,
      });
      return true;
    }

    await sendRichestLeaderboard(interaction.guild, client, false);
    await interaction.reply({
      content: `✅ Classement des plus riches republié dans <#${RICHEST_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

const RICH_MEDALS = ["🥇", "🥈", "🥉", "🏅", "🏅"];

function getSortedRichest(state) {
  return Object.entries(state.balances)
    .map(([userId, balance]) => ({ userId, balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, RICHEST_TOP);
}

function buildRichestEmbed(guild, state) {
  const ranked = getSortedRichest(state);

  let body;
  if (!ranked.length) {
    body = "*Aucun compte enregistré pour le moment.*";
  } else {
    body = ranked
      .map((entry, i) => {
        const medal = RICH_MEDALS[i] ?? `**${i + 1}.**`;
        const member = guild.members.cache.get(entry.userId);
        const name = member ? `${member}` : `<@${entry.userId}>`;
        return `${medal} ${name} — **${formatEuro(entry.balance)}**`;
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(RICHEST_TITLE)
    .setDescription(
      "Les membres avec le plus gros solde sur `/bank`.\n\n" + body
    )
    .setFooter({
      text: `Top ${RICHEST_TOP} • Classement hebdomadaire (chaque dimanche)`,
    })
    .setTimestamp();
}

function buildRichestRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_REFRESH_RICHEST)
      .setLabel("Actualiser")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendRichestLeaderboard(guild, client, replacePrevious = false) {
  const channel = await client.channels.fetch(RICHEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return false;

  await guild.members.fetch().catch(() => null);

  const state = loadState();
  const embed = buildRichestEmbed(guild, state);
  const components = [buildRichestRefreshRow()];

  if (replacePrevious && state.richestMessageId) {
    const old = await channel.messages.fetch(state.richestMessageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const sent = await channel.send({ embeds: [embed], components });
  state.richestMessageId = sent.id;
  saveState(state);

  return true;
}

async function richestLeaderboardExists(channel, client, state) {
  if (state.richestMessageId) {
    const msg = await channel.messages.fetch(state.richestMessageId).catch(() => null);
    if (msg) return true;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return (
    messages?.some(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === RICHEST_TITLE
    ) ?? false
  );
}

async function ensureRichestLeaderboard(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await client.channels.fetch(RICHEST_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const state = loadState();
    const exists = await richestLeaderboardExists(channel, client, state);

    if (!exists) {
      await sendRichestLeaderboard(guild, client, false);
      console.log(`[${guild.name}] Classement des plus riches publié (aucun tableau détecté)`);
    }
  }
}

function startRichestLeaderboardScheduler(client) {
  ensureRichestLeaderboard(client).catch((err) =>
    console.error("Classement des plus riches (initial):", err.message)
  );

  cron.schedule(
    "0 9 * * 0",
    () => {
      for (const guild of client.guilds.cache.values()) {
        sendRichestLeaderboard(guild, client, true).catch((err) =>
          console.error("Classement des plus riches (dimanche):", err.message)
        );
      }
    },
    { timezone: "Europe/Paris" }
  );
  console.log("Classement des plus riches : envoi programmé chaque dimanche à 9h00 (Paris)");
}

function registerBankCommand() {
  return new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Voir le solde de votre compte")
    .toJSON();
}

function registerAddMoneyCommand() {
  return new SlashCommandBuilder()
    .setName("addmoney")
    .setDescription("Ajouter de l'argent sur le compte d'un membre (Fondation uniquement)")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à créditer").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à ajouter (€)")
        .setRequired(true)
        .setMinValue(0.01)
    )
    .toJSON();
}

function registerDelMoneyCommand() {
  return new SlashCommandBuilder()
    .setName("delbank")
    .setDescription("Retirer de l'argent du compte d'un membre (Fondation uniquement)")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à débiter").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à retirer (€)")
        .setRequired(true)
        .setMinValue(0.01)
    )
    .toJSON();
}

function registerClassementSetupCommand() {
  return new SlashCommandBuilder()
    .setName("classement-setup")
    .setDescription("Republier le classement des plus riches (Fondation uniquement)")
    .toJSON();
}

module.exports = {
  getBalance,
  addFunds,
  removeFunds,
  hasEnough,
  formatEuro,
  applyTax,
  logTransaction,
  handleBankInteraction,
  registerBankCommand,
  registerAddMoneyCommand,
  registerDelMoneyCommand,
  registerClassementSetupCommand,
  startRichestLeaderboardScheduler,
  DEFAULT_BALANCE,
  TAX_RATE,
  TRANSACTION_LOG_CHANNEL_ID,
};
