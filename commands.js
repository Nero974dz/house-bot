const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const {
  registerBankCommand,
  registerAddMoneyCommand,
  registerDelMoneyCommand,
  registerVirementCommand,
  registerDepositCommand,
  registerClassementSetupCommand,
  registerSaisieCommand,
  registerAvertissementCommand,
  registerResetCommand,
} = require("./bank");
const { registerParisCommand } = require("./paris");
const { registerSend1Command } = require("./send1");
const { registerCasinoCommand } = require("./casino");
const { registerLicenseCommand, registerTabLicenseCommand } = require("./license");
const { registerIrfSetupCommand } = require("./irf");
const { registerAirbnbSetupCommand } = require("./airbnb");
const { registerElectionSetupCommand } = require("./election");

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
      .setDescription("Gérer les correctifs (Fondation uniquement)")
      .addSubcommand(sub => sub.setName("publier").setDescription("Publier tous les correctifs en attente"))
      .addSubcommand(sub => sub
        .setName("ajouter")
        .setDescription("Ajouter un correctif manuellement")
        .addStringOption(o => o.setName("texte").setDescription("Texte du correctif (ex: [Casino] Nouvelle fonctionnalité...)").setRequired(true).setMaxLength(500))
      )
      .addSubcommand(sub => sub.setName("modifier").setDescription("Modifier le dernier message de correctif publié"))
      .toJSON(),
    registerBankCommand(),
    registerAddMoneyCommand(),
    registerDelMoneyCommand(),
    registerVirementCommand(),
    registerDepositCommand(),
    registerClassementSetupCommand(),
    registerSaisieCommand(),
    registerAvertissementCommand(),
    registerResetCommand(),
    registerParisCommand(),
    registerSend1Command(),
    registerCasinoCommand(),
    registerLicenseCommand(),
    registerTabLicenseCommand(),
    registerIrfSetupCommand(),
    registerAirbnbSetupCommand(),
    registerElectionSetupCommand(),
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
    "Commandes /achat, /report, /crédit, /mission, /chat, /correctif, /bank, /addmoney, /delbank, /virement, /classement-setup, /pari-setup, /send1, /casino-setup, /license et /tablicense enregistrées"
  );
}

module.exports = { registerSlashCommands };
