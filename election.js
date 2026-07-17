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

const ELECTION_CHANNEL_ID  = "1527552413484060702";
const ELECTION_CATEGORY_ID = "1527551774704144475";
const FONDATION_ROLE_ID    = "1509974377267990659";
const STATE_FILE = getStatePath("election-state.json");

const BTN_PRESENTER  = "election_presenter";
const BTN_RETIRER    = "election_retirer";
const BTN_VOTE_START = "election_vote_start";
const BTN_VOTER      = "election_voter";
const BTN_CLOTURE    = "election_cloture";
const MODAL_PRESENT  = "election_modal_present";
const SELECT_VOTE    = "election_select_vote";

// ---------- STATE ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { messageId: null, phase: "inscription", candidates: {}, voters: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("election-state.json");
}

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

// ---------- EMBEDS ----------
function buildPanelEmbed(state) {
  const candidates = Object.values(state.candidates);
  const phase = state.phase;

  let color, title, desc;

  if (phase === "inscription") {
    color = 0x3498db;
    title = "🗳️ Élection — Délégué des membres";
    desc  = candidates.length === 0
      ? "*Aucun candidat pour le moment. Cliquez sur **Se Présenter** !*"
      : candidates.map((c, i) =>
          `**${i + 1}. ${c.username}**\n*"${c.presentation}"*`
        ).join("\n\n");

  } else if (phase === "vote") {
    color = 0xe67e22;
    title = "🗳️ Élection — Vote en cours";
    desc  = `**${candidates.length} candidat${candidates.length > 1 ? "s" : ""}** en lice.\n\nCliquez sur **Voter** pour choisir votre candidat.\nLe vote est **anonyme**.\n\n` +
            candidates.map((c, i) => `**${i + 1}. ${c.username}**\n*"${c.presentation}"*`).join("\n\n");

  } else {
    // terminee
    color = 0x2ecc71;
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    title = "🏆 Élection — Résultats";
    desc  = `**Délégué élu : ${winner?.username || "—"}** 🎉\n\n` +
            sorted.map((c, i) =>
              `**${i + 1}. ${c.username}** — ${c.votes} vote${c.votes > 1 ? "s" : ""}`
            ).join("\n");
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();

  if (phase === "inscription") {
    embed.addFields({ name: "📋 Candidats", value: `**${candidates.length}** inscrit${candidates.length > 1 ? "s" : ""}`, inline: true });
    embed.setFooter({ text: "Présentez-vous avant que la Fondation ouvre le vote" });
  } else if (phase === "vote") {
    embed.addFields({ name: "🗳️ Votes exprimés", value: `**${state.voters.length}**`, inline: true });
    embed.setFooter({ text: "Vote anonyme — un seul vote par membre" });
  }

  return embed;
}

function buildPanelComponents(state) {
  const phase = state.phase;
  const rows = [];

  if (phase === "inscription") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_PRESENTER).setLabel("Se Présenter").setEmoji("🙋").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_RETIRER).setLabel("Retirer ma candidature").setEmoji("❌").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BTN_VOTE_START).setLabel("Passer au Vote").setEmoji("🗳️").setStyle(ButtonStyle.Success),
    ));
  } else if (phase === "vote") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_VOTER).setLabel("Voter").setEmoji("🗳️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_CLOTURE).setLabel("Clôturer & Résultats").setEmoji("🏆").setStyle(ButtonStyle.Danger),
    ));
  }

  return rows;
}

async function updatePanel(client) {
  const channel = await client.channels.fetch(ELECTION_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const state = loadState();
  const payload = { embeds: [buildPanelEmbed(state)], components: buildPanelComponents(state) };

  if (state.messageId) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) { await existing.edit(payload).catch(() => null); return; }
  }
  const msg = await channel.send(payload);
  state.messageId = msg.id;
  saveState(state);
}

async function setupElectionPanel(client) {
  await updatePanel(client);
  console.log("Panel Élection publié");
}

// ---------- HANDLER ----------
async function handleElectionInteraction(interaction, client) {
  const customId = interaction.customId || "";
  if (!customId.startsWith("election_") && interaction.commandName !== "election-setup") return false;

  // --- Setup ---
  if (interaction.isChatInputCommand() && interaction.commandName === "election-setup") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({ content: "❌ Réservé à la Fondation.", ephemeral: true });
      return true;
    }
    // Reset l'élection
    const state = { messageId: null, phase: "inscription", candidates: {}, voters: [] };
    saveState(state);
    await setupElectionPanel(client);
    await interaction.reply({ content: "✅ Nouvelle élection lancée.", ephemeral: true });
    return true;
  }

  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;

  // --- Se présenter ---
  if (customId === BTN_PRESENTER) {
    const state = loadState();
    if (state.phase !== "inscription") {
      await interaction.reply({ content: "❌ Les inscriptions sont closes.", ephemeral: true });
      return true;
    }
    if (state.candidates[interaction.user.id]) {
      await interaction.reply({ content: "❌ Vous êtes déjà candidat.", ephemeral: true });
      return true;
    }
    await interaction.showModal(
      new ModalBuilder().setCustomId(MODAL_PRESENT).setTitle("🙋 Se présenter")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("presentation")
              .setLabel("Votre message de présentation")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setPlaceholder("Présentez-vous en quelques phrases : qui vous êtes, pourquoi vous voulez être délégué...")
              .setMaxLength(500)
          )
        )
    );
    return true;
  }

  // --- Modal présentation ---
  if (interaction.isModalSubmit() && customId === MODAL_PRESENT) {
    const state = loadState();
    if (state.phase !== "inscription") {
      await interaction.reply({ content: "❌ Les inscriptions sont closes.", ephemeral: true });
      return true;
    }
    if (state.candidates[interaction.user.id]) {
      await interaction.reply({ content: "❌ Vous êtes déjà candidat.", ephemeral: true });
      return true;
    }
    const presentation = interaction.fields.getTextInputValue("presentation").trim();
    state.candidates[interaction.user.id] = {
      userId: interaction.user.id,
      username: interaction.user.username,
      presentation,
      votes: 0,
      registeredAt: Date.now(),
    };
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: `✅ Votre candidature a été enregistrée !`, ephemeral: true });
    return true;
  }

  // --- Retirer candidature ---
  if (customId === BTN_RETIRER) {
    const state = loadState();
    if (state.phase !== "inscription") {
      await interaction.reply({ content: "❌ Les inscriptions sont closes.", ephemeral: true });
      return true;
    }
    if (!state.candidates[interaction.user.id]) {
      await interaction.reply({ content: "❌ Vous n'êtes pas candidat.", ephemeral: true });
      return true;
    }
    delete state.candidates[interaction.user.id];
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: "✅ Votre candidature a été retirée.", ephemeral: true });
    return true;
  }

  // --- Passer au vote (Fondation) ---
  if (customId === BTN_VOTE_START) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({ content: "❌ Réservé à la Fondation.", ephemeral: true });
      return true;
    }
    const state = loadState();
    if (state.phase !== "inscription") {
      await interaction.reply({ content: "❌ Le vote est déjà en cours ou terminé.", ephemeral: true });
      return true;
    }
    if (Object.keys(state.candidates).length < 2) {
      await interaction.reply({ content: "❌ Il faut au moins **2 candidats** pour ouvrir le vote.", ephemeral: true });
      return true;
    }
    state.phase = "vote";
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: "✅ Le vote est maintenant ouvert !", ephemeral: true });
    return true;
  }

  // --- Voter ---
  if (customId === BTN_VOTER) {
    const state = loadState();
    if (state.phase !== "vote") {
      await interaction.reply({ content: "❌ Le vote n'est pas ouvert.", ephemeral: true });
      return true;
    }
    if (state.voters.includes(interaction.user.id)) {
      await interaction.reply({ content: "✅ Vous avez déjà voté.", ephemeral: true });
      return true;
    }
    const candidates = Object.values(state.candidates);
    const options = candidates.map(c => ({
      label: c.username,
      description: c.presentation.slice(0, 100),
      value: c.userId,
    }));
    await interaction.reply({
      content: "🗳️ Pour qui votez-vous ? Votre choix est **anonyme**.",
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SELECT_VOTE)
          .setPlaceholder("Choisir un candidat")
          .addOptions(options)
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select vote ---
  if (customId === SELECT_VOTE) {
    const state = loadState();
    if (state.phase !== "vote") {
      await interaction.update({ content: "❌ Le vote est fermé.", components: [] });
      return true;
    }
    if (state.voters.includes(interaction.user.id)) {
      await interaction.update({ content: "✅ Vous avez déjà voté.", components: [] });
      return true;
    }
    const targetId = interaction.values[0];
    if (!state.candidates[targetId]) {
      await interaction.update({ content: "❌ Candidat introuvable.", components: [] });
      return true;
    }
    state.candidates[targetId].votes += 1;
    state.voters.push(interaction.user.id);
    saveState(state);
    // Mettre à jour le compteur de votes dans le panel sans révéler les détails
    await updatePanel(client);
    await interaction.update({ content: `✅ Vote enregistré. Merci d'avoir participé !`, components: [] });
    return true;
  }

  // --- Clôturer (Fondation) ---
  if (customId === BTN_CLOTURE) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({ content: "❌ Réservé à la Fondation.", ephemeral: true });
      return true;
    }
    const state = loadState();
    if (state.phase !== "vote") {
      await interaction.reply({ content: "❌ Le vote n'est pas en cours.", ephemeral: true });
      return true;
    }
    state.phase = "terminee";
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: "✅ Élection clôturée. Les résultats sont affichés.", ephemeral: true });
    return true;
  }

  return false;
}

function registerElectionSetupCommand() {
  return new SlashCommandBuilder()
    .setName("election-setup")
    .setDescription("Lancer une nouvelle élection (Fondation uniquement)")
    .toJSON();
}

module.exports = { setupElectionPanel, handleElectionInteraction, registerElectionSetupCommand };
