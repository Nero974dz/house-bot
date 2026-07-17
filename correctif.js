const fs = require("fs");
const { EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getStatePath, persistState } = require("./storage");

const FONDATION_ROLE_ID = "1509974377267990659";
const CORRECTIF_CHANNEL_ID = "1509983723892903966";

const STATE_FILE = getStatePath("correctif-state.json");

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
  persistState("correctif-state.json");
}

/** Appelé à chaque ajustement/fix pour l'ajouter au prochain /correctif. */
function addCorrectifEntry(text) {
  const state = loadState();
  state.unreleased.push({ text, addedAt: Date.now() });
  saveState(state);
}

function buildCorrectifEmbed(entries, author) {
  // Regrouper par catégorie (préfixe entre crochets ex: [IRF])
  const groups = {};
  const noGroup = [];
  for (const e of entries) {
    const match = e.text.match(/^\[(.+?)\]\s*/);
    if (match) {
      const cat = match[1];
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(e.text.replace(/^\[.+?\]\s*/, ""));
    } else {
      noGroup.push(e.text);
    }
  }

  const fields = [];
  for (const [cat, items] of Object.entries(groups)) {
    fields.push({ name: cat, value: items.map(i => `› ${i}`).join("\n"), inline: false });
  }
  if (noGroup.length) {
    fields.push({ name: "Divers", value: noGroup.map(i => `› ${i}`).join("\n"), inline: false });
  }

  const version = `v${new Date().toLocaleDateString("fr-FR").replace(/\//g, ".")}`;

  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`📦 Mise à jour ${version}`)
    .setDescription("Voici les nouveautés et améliorations apportées aujourd'hui à la Maison.\n​")
    .addFields(fields)
    .setFooter({ text: `Publié par ${author.username} · ${entries.length} changement${entries.length > 1 ? "s" : ""}` })
    .setTimestamp();
}

async function handleCorrectifInteraction(interaction) {
  // Modal modification
  if (interaction.isModalSubmit() && interaction.customId === "correctif_modal_edit") {
    const contenu = interaction.fields.getTextInputValue("contenu").trim();
    const state = loadState();
    const channel = await interaction.guild.channels.fetch(CORRECTIF_CHANNEL_ID).catch(() => null);
    const msg = await channel?.messages.fetch(state.lastMessageId).catch(() => null);
    if (!msg) { await interaction.reply({ content: "❌ Message introuvable.", ephemeral: true }); return true; }

    const version = `v${new Date().toLocaleDateString("fr-FR").replace(/\//g, ".")}`;
    const newEmbed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`📦 Mise à jour ${version}`)
      .setDescription("Voici les nouveautés et améliorations apportées à la Maison.\n​")
      .setDescription(contenu.slice(0, 4000))
      .setFooter({ text: `Modifié par ${interaction.user.username}` })
      .setTimestamp();

    await msg.edit({ embeds: [newEmbed] });
    await interaction.reply({ content: "✅ Correctif modifié.", ephemeral: true });
    return true;
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== "correctif") return false;

  if (!isFondation(interaction.member)) {
    await interaction.reply({ content: `❌ Seule la **Fondation** peut utiliser \`/correctif\`.`, ephemeral: true });
    return true;
  }

  const sub = interaction.options.getSubcommand(false);

  // --- /correctif modifier ---
  if (sub === "modifier") {
    const state = loadState();
    if (!state.lastMessageId) {
      await interaction.reply({ content: "❌ Aucun message de correctif trouvé à modifier.", ephemeral: true });
      return true;
    }
    const channel = await interaction.guild.channels.fetch(CORRECTIF_CHANNEL_ID).catch(() => null);
    const msg = await channel?.messages.fetch(state.lastMessageId).catch(() => null);
    if (!msg) {
      await interaction.reply({ content: "❌ Message introuvable (peut-être supprimé).", ephemeral: true });
      return true;
    }
    // Récupérer le contenu actuel des champs pour pré-remplir
    const currentDesc = msg.embeds[0]?.fields?.map(f => `[${f.name}]\n${f.value.replace(/› /g, "")}`).join("\n\n") || "";
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId("correctif_modal_edit")
        .setTitle("✏️ Modifier le correctif")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("contenu")
              .setLabel("Contenu (format libre, modifiez le texte)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setValue(currentDesc.slice(0, 4000))
          )
        )
    );
    return true;
  }

  // --- /correctif ajouter ---
  if (sub === "ajouter") {
    const texte = interaction.options.getString("texte", true);
    addCorrectifEntry(texte);
    const state = loadState();
    await interaction.reply({
      content: `✅ Entrée ajoutée. **${state.unreleased.length}** correctif(s) en attente.`,
      ephemeral: true,
    });
    return true;
  }

  // --- /correctif publier (ou ancienne syntaxe sans sous-commande) ---
  const state = loadState();
  if (!state.unreleased.length) {
    await interaction.reply({ content: "ℹ️ Aucun correctif en attente de publication.", ephemeral: true });
    return true;
  }

  const channel = await interaction.guild.channels.fetch(CORRECTIF_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: "❌ Salon des correctifs introuvable.", ephemeral: true });
    return true;
  }

  const sent = await channel.send({ embeds: [buildCorrectifEmbed(state.unreleased, interaction.user)] });

  state.history.push({ entries: state.unreleased, publishedAt: Date.now(), publishedBy: interaction.user.id, messageId: sent.id });
  const count = state.unreleased.length;
  state.unreleased = [];
  state.lastMessageId = sent.id;
  saveState(state);

  await interaction.reply({ content: `✅ **${count}** correctif(s) publié(s) dans <#${CORRECTIF_CHANNEL_ID}>.`, ephemeral: true });
  return true;
}

module.exports = {
  handleCorrectifInteraction,
  addCorrectifEntry,
  CORRECTIF_CHANNEL_ID,
};
