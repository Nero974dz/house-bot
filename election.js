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
async function buildPanelEmbeds(state, guild) {
  const candidates = Object.values(state.candidates);
  const phase = state.phase;
  const embeds = [];

  if (phase === "inscription") {
    const main = new EmbedBuilder()
      .setColor(0x2c3e50)
      .setTitle("🗳️ Élection — Délégué des membres")
      .setDescription(
        "Le **Délégué** est le représentant officiel de tous les membres de la Maison.\n" +
        "Il sert d'intermédiaire entre les résidents et la Fondation.\n​"
      )
      .addFields(
        { name: "📋 Candidats inscrits", value: `**${candidates.length}**`, inline: true },
        { name: "📌 Phase",              value: "**Inscriptions ouvertes**", inline: true },
      )
      .setFooter({ text: "Présentez-vous avant que la Fondation ouvre le vote" })
      .setTimestamp();
    embeds.push(main);

    for (let i = 0; i < Math.min(candidates.length, 9); i++) {
      const c = candidates[i];
      let avatarURL = null;
      try {
        const member = await guild.members.fetch(c.userId).catch(() => null);
        avatarURL = member?.user.displayAvatarURL({ size: 128 }) || null;
      } catch {}

      const card = new EmbedBuilder()
        .setColor(0x3498db)
        .setAuthor({ name: `Candidat n°${i + 1} — ${c.username}`, iconURL: avatarURL || undefined })
        .setDescription(`*"${c.presentation}"*`)
        .setThumbnail(avatarURL)
        .setTimestamp(c.registeredAt);
      embeds.push(card);
    }

  } else if (phase === "vote") {
    const main = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("🗳️ Élection — Vote en cours !")
      .setDescription(
        "Le vote est maintenant **ouvert**.\nCliquez sur **🗳️ Voter** pour choisir votre candidat.\n" +
        "Votre choix est entièrement **anonyme**.\n​"
      )
      .addFields(
        { name: "🙋 Candidats",        value: `**${candidates.length}**`,       inline: true },
        { name: "🗳️ Votes exprimés",   value: `**${state.voters.length}**`,     inline: true },
      )
      .setFooter({ text: "Un seul vote par membre — anonyme et définitif" })
      .setTimestamp();
    embeds.push(main);

    for (let i = 0; i < Math.min(candidates.length, 9); i++) {
      const c = candidates[i];
      let avatarURL = null;
      try {
        const member = await guild.members.fetch(c.userId).catch(() => null);
        avatarURL = member?.user.displayAvatarURL({ size: 128 }) || null;
      } catch {}

      const card = new EmbedBuilder()
        .setColor(0xe67e22)
        .setAuthor({ name: `Candidat n°${i + 1} — ${c.username}`, iconURL: avatarURL || undefined })
        .setDescription(`*"${c.presentation}"*`)
        .setThumbnail(avatarURL);
      embeds.push(card);
    }

  } else {
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    let winnerAvatar = null;
    try {
      const m = await guild.members.fetch(winner.userId).catch(() => null);
      winnerAvatar = m?.user.displayAvatarURL({ size: 256 }) || null;
    } catch {}

    const main = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🏆 Élection terminée — Résultats")
      .setDescription(`**🎉 Félicitations à ${winner?.username || "—"} !\nÉlu Délégué des membres.**\n​`)
      .setThumbnail(winnerAvatar)
      .setTimestamp();
    embeds.push(main);

    for (let i = 0; i < Math.min(sorted.length, 9); i++) {
      const c = sorted[i];
      let avatarURL = null;
      try {
        const member = await guild.members.fetch(c.userId).catch(() => null);
        avatarURL = member?.user.displayAvatarURL({ size: 128 }) || null;
      } catch {}

      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
      const card = new EmbedBuilder()
        .setColor(i === 0 ? 0xf1c40f : i === 1 ? 0x95a5a6 : i === 2 ? 0xe67e22 : 0x2c3e50)
        .setAuthor({ name: `${medal} ${c.username} — ${c.votes} vote${c.votes > 1 ? "s" : ""}`, iconURL: avatarURL || undefined })
        .setThumbnail(avatarURL);
      embeds.push(card);
    }
  }

  return embeds;
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
  const embeds = await buildPanelEmbeds(state, channel.guild);
  const payload = { embeds, components: buildPanelComponents(state) };

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
