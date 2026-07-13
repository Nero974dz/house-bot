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
  console.log("Commandes /achat, /report, /niveau, /crédit et /mission enregistrées");
}

module.exports = { registerSlashCommands };
