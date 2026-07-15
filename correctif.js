const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");

const FONDATION_ROLE_ID = "1509974377267990659";
const CORRECTIF_CHANNEL_ID = "1527025330852991097";

const STATE_FILE = path.join(__dirname, "correctif-state.json");

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.unreleased)) data.unreleased = [];
    if (!Array.isArray(data.history)) data.history = [];
    return data;
  } catch {
    return { unreleased: [], history: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Appelé à chaque ajustement/fix pour l'ajouter au prochain /correctif. */
function addCorrectifEntry(text) {
  const state = loadState();
  state.unreleased.push({ text, addedAt: Date.now() });
  saveState(state);
}

function buildCorrectifEmbed(entries, author) {
  const lines = entries.map((e) => `• ${e.text}`).join("\n");
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("🛠️ Correctifs")
    .setDescription(lines.slice(0, 4000))
    .setFooter({ text: `Publié par ${author.tag}` })
    .setTimestamp();
}

async function handleCorrectifInteraction(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== "correctif"
  ) {
    return false;
  }

  if (!isFondation(interaction.member)) {
    await interaction.reply({
      content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/correctif\`.`,
      ephemeral: true,
    });
    return true;
  }

  const state = loadState();
  if (!state.unreleased.length) {
    await interaction.reply({
      content: "ℹ️ Aucun correctif en attente de publication.",
      ephemeral: true,
    });
    return true;
  }

  const channel = await interaction.guild.channels
    .fetch(CORRECTIF_CHANNEL_ID)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: "❌ Salon des correctifs introuvable. Contactez un admin.",
      ephemeral: true,
    });
    return true;
  }

  await channel.send({
    embeds: [buildCorrectifEmbed(state.unreleased, interaction.user)],
  });

  state.history.push({
    entries: state.unreleased,
    publishedAt: Date.now(),
    publishedBy: interaction.user.id,
  });
  state.unreleased = [];
  saveState(state);

  await interaction.reply({
    content: `✅ ${state.history.at(-1).entries.length} correctif(s) publié(s) dans <#${CORRECTIF_CHANNEL_ID}>.`,
    ephemeral: true,
  });
  return true;
}

module.exports = {
  handleCorrectifInteraction,
  addCorrectifEntry,
  CORRECTIF_CHANNEL_ID,
};
