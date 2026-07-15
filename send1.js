const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");

const FONDATION_ROLE_ID = "1509974377267990659";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function buildSend1Embed() {
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("🆕 Nouveautés sur le serveur !")
    .setDescription(
      "💰 **`/bank`** — Découvrez votre nouveau compte personnel ! Chaque membre démarre avec **500 €**. " +
        "Ce solde vous servira pour les paris sportifs, et bientôt pour le casino qui arrive.\n\n" +
        "🛠️ **`/correctif`** *(Fondation)* — Un nouveau canal pour tenir tout le monde informé : à chaque mise à jour du bot, " +
        "la liste des correctifs et améliorations sera publiée automatiquement.\n\n" +
        "D'autres surprises arrivent bientôt... 👀"
    )
    .setTimestamp();
}

async function handleSend1Interaction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "send1") {
    return false;
  }

  if (!isFondation(interaction.member)) {
    await interaction.reply({
      content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/send1\`.`,
      ephemeral: true,
    });
    return true;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: "❌ Cette commande ne peut être utilisée que dans un salon textuel.",
      ephemeral: true,
    });
    return true;
  }

  await channel.send({ embeds: [buildSend1Embed()] });
  await interaction.reply({
    content: "✅ Message envoyé.",
    ephemeral: true,
  });
  return true;
}

function registerSend1Command() {
  return new SlashCommandBuilder()
    .setName("send1")
    .setDescription("Publier l'annonce des nouveautés (Fondation uniquement)")
    .toJSON();
}

module.exports = { handleSend1Interaction, registerSend1Command };
