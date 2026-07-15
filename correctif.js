const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

const FONDATION_ROLE_ID = "1509974377267990659";
const CORRECTIF_CHANNEL_ID = "1527025330852991097";

const MODAL_CORRECTIF = "correctif_modal";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function buildCorrectifModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_CORRECTIF)
    .setTitle("🛠️ Publier un correctif")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("titre")
          .setLabel("Titre (optionnel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setPlaceholder("Ex. Mise à jour du 15/07")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("correctifs")
          .setLabel("Correctifs apportés")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setPlaceholder("• Correction de...\n• Ajout de...\n• Amélioration de...")
      )
    );
}

function buildCorrectifEmbed(titre, correctifs, author) {
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`🛠️ ${titre || "Correctifs"}`)
    .setDescription(correctifs)
    .setFooter({ text: `Publié par ${author.tag}` })
    .setTimestamp();
}

async function handleCorrectifInteraction(interaction) {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "correctif"
  ) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/correctif\`.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.showModal(buildCorrectifModal());
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_CORRECTIF) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: "❌ Permission refusée.",
        ephemeral: true,
      });
      return true;
    }

    const titre = interaction.fields.getTextInputValue("titre")?.trim();
    const correctifs = interaction.fields.getTextInputValue("correctifs").trim();

    if (!correctifs) {
      await interaction.reply({
        content: "❌ Le champ des correctifs ne peut pas être vide.",
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
      embeds: [buildCorrectifEmbed(titre, correctifs, interaction.user)],
    });

    await interaction.reply({
      content: `✅ Correctif publié dans <#${CORRECTIF_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = { handleCorrectifInteraction, CORRECTIF_CHANNEL_ID };
