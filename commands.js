const { REST, Routes, SlashCommandBuilder } = require("discord.js");

async function registerSlashCommands(client, token) {
  const commands = [
    new SlashCommandBuilder()
      .setName("achat")
      .setDescription("Demande d'achat d'un produit")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("report")
      .setDescription("Signaler anonymement le comportement d'un membre")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("niveau")
      .setDescription("Voir votre progression et votre niveau sur le serveur")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("crédit")
      .setDescription("Demander un crédit argent")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("mission")
      .setDescription(
        "Publier une mission sur le panel intérim (Fondation uniquement)"
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("chat")
      .setDescription(
        "Envoyer un message via le bot (Fondation uniquement)"
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Texte à publier dans ce salon")
          .setRequired(true)
          .setMaxLength(2000)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("correctif")
      .setDescription(
        "Publier les correctifs apportés (Fondation uniquement)"
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(token);
  for (const guild of client.guilds.cache.values()) {
    await rest
      .put(Routes.applicationGuildCommands(client.user.id, guild.id), {
        body: commands,
      })
      .catch((err) =>
        console.warn(`Commandes slash (${guild.name}):`, err.message)
      );
  }
  console.log(
    "Commandes /achat, /report, /niveau, /crédit, /mission, /chat et /correctif enregistrées"
  );
}

module.exports = { registerSlashCommands };
