const fs = require("fs");
const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { getStatePath, persistState } = require("./storage");

const STATE_FILE = getStatePath("bank-state.json");
const DEFAULT_BALANCE = 500;

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.balances || typeof data.balances !== "object") data.balances = {};
    return data;
  } catch {
    return { balances: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("bank-state.json");
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
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
  state.balances[userId] = Math.round((state.balances[userId] + amount) * 100) / 100;
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

async function handleBankInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "bank") {
    return false;
  }

  const balance = getBalance(interaction.user.id);
  await interaction.reply({
    embeds: [buildBalanceEmbed(interaction.user, balance)],
    ephemeral: true,
  });
  return true;
}

function registerBankCommand() {
  return new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Voir le solde de votre compte")
    .toJSON();
}

module.exports = {
  getBalance,
  addFunds,
  removeFunds,
  hasEnough,
  formatEuro,
  handleBankInteraction,
  registerBankCommand,
  DEFAULT_BALANCE,
};
