const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  PermissionFlagsBits,
  ChannelType,
  StringSelectMenuBuilder,
  AuditLogEvent,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error(
    "Variable DISCORD_TOKEN manquante. Définissez-la dans Railway ou dans un fichier .env local."
  );
  process.exit(1);
}

const WELCOME_ROLE_ID = "1509970096821375128";
const WELCOME_CHANNEL_ID = "1509966808675778590";
const WELCOME_EMBED_IMAGE =
  "https://cdn.discordapp.com/attachments/1344671822599426138/1505903724420272249/0BD58C7C-5F87-4FA4-8710-05DFED692781.gif";

const RULES_CHANNEL_ID = "1509974903552737333";
const RULES_LOG_CHANNEL_ID = "1509974614095429853";
const RULES_ACCEPTED_ROLE_ID = "1509975426179797012";
const ACCEPT_RULES_BUTTON_ID = "accept_reglement";

const TICKET_PANEL_CHANNEL_ID = "1509976660966117537";
const TICKET_PANEL_BANNER =
  "https://images-ext-1.discordapp.net/external/fymp_3Bv8_xq96BUOw_Mow-LTyXwUvGej1pTsjBI2N4/https/crowbots.shop/image/32INI.1507463853666210074.jpg?format=webp&width=1226&height=325";
const TICKET_CATEGORY_ID = "1509977402485510345";
const TICKET_SELECT_MENU_ID = "ticket_open_menu";
const CLOSE_TICKET_BUTTON_ID = "close_ticket";
// Rôle staff pouvant voir tous les tickets (null = désactivé, admins Discord voient quand même)
const TICKET_STAFF_ROLE_ID = null;
const TICKET_LOG_CHANNEL_ID = "1510687492896981102";
const FONDATION_ROLE_ID = "1509974377267990659";
const WEEKLY_BILAN_CHANNEL_ID = "1510687492896981102";

const {
  CANDIDATURE_CATEGORY_ID,
  ADMIN_VOTE_ROLE_ID,
  isCandidatureCategory,
  startCandidatureQuestionnaire,
  handleCandidatureVote,
  setupCandidatureCategoryPermissions,
  restoreCandidatureReminders,
} = require("./candidature");
const {
  refreshHierarchy,
  memberHasHierarchyRole,
} = require("./hierarchie");
const { startRepasScheduler } = require("./repas");
const { setupChambresPanel, handleChambreInteraction } = require("./chambres");
const {
  setupBudgetPanel,
  startBudgetScheduler,
  handleBudgetInteraction,
  handleAchatDmMessage,
  getWeeklyReportEmbed,
} = require("./budget");
const {
  setupSignalementPanel,
  handleSignalementInteraction,
  getWeeklyBilanEmbed,
} = require("./signalements");
const cron = require("node-cron");
const { registerSlashCommands } = require("./commands");
const { setupShopPanel, handleShopInteraction } = require("./boutique");
const { setupCreditTable, handleCreditInteraction } = require("./credit");
const { setupMissionPanel, handleMissionInteraction } = require("./missions");
const { handleChatInteraction } = require("./chat");
const { pullAllStateFiles, GITHUB_ENABLED, flushPendingWrites, testGithubWrite } = require("./storage");
const { handleCorrectifInteraction } = require("./correctif");
const { handleBankInteraction, handleSecretBankCommand, handleDmAddMoney, startRichestLeaderboardScheduler, initAllMembersBalance, addFunds } = require("./bank");
const { setupIrfPanel, handleIrfInteraction } = require("./irf");
const { setupAirbnbPanel, handleAirbnbInteraction } = require("./airbnb");
const { setupElectionPanel, handleElectionInteraction } = require("./election");
const { handleParisInteraction } = require("./paris");
const { handleSend1Interaction } = require("./send1");
const { handleCasinoInteraction, setupCasinoPanel } = require("./casino");
const { handleLicenseInteraction } = require("./license");
const { setupReopeningAnnouncement } = require("./annonce");

const TICKET_TYPES = {
  question: {
    label: "Question",
    prefix: "question",
    emoji: "❓",
    description: "Poser une question au staff",
  },
  candidature: {
    label: "Candidature",
    prefix: "candidature",
    emoji: "📋",
    description: "Postuler / recrutement",
  },
  report: {
    label: "Report",
    prefix: "report",
    emoji: "🚨",
    description: "Signaler un problème",
  },
  identification: {
    label: "Identification",
    prefix: "identification",
    emoji: "🪪",
    description: "Confirmer votre identité",
  },
};

const RULES_TEXT = `Merci de lire attentivement ce règlement avant d'accéder au serveur.
Le respect de ces règles permet de garder une bonne ambiance pour tout le monde.

---

## 🤝 Respect & Comportement

• Le respect entre tous les membres est obligatoire.
• Les insultes, provocations, conflits et attaques personnelles sont interdits.
• Un comportement mature, calme et respectueux est attendu en permanence.
• Le respect du staff et des décisions prises est obligatoire.

---

## 🔒 Confidentialité & Sécurité

• Il est interdit de partager des informations personnelles appartenant à une autre personne.
• Tout harcèlement, menace ou intimidation entraînera une sanction immédiate.
• Les contenus illégaux, violents, choquants ou inappropriés sont strictement interdits.

---

## 🏠 Vie dans la Maison

• L'hébergement est un privilège, pas un droit acquis.
• Chaque membre doit contribuer à maintenir un environnement sain et bienveillant.
• L'accès est autorisé uniquement à votre propre chambre.
• Toute absence de plus de 7 jours sans prévenir peut entraîner la perte de votre place.

---

## 🚫 Contenus & Actions Interdites

• Le spam, les dramas et les provocations sont interdits.
• Toute publicité sans autorisation est interdite.
• Les relations sexuelles au sein de la Maison sont interdites.
• Les nudes et contenus sexuels sont strictement interdits.

---

## ⏰ Horaires & Organisation

### Sorties autorisées :

• Mineurs : jusqu'à 21h00
• Majeurs : jusqu'à 00h00

Après ces horaires, les portes de la Maison sont considérées comme fermées.

---

## ⚖️ Sanctions

• Les sanctions sont appliquées selon la gravité des faits.
• La décision finale revient à la Propriétaire.

---

✅ En restant sur ce serveur, vous acceptez l'ensemble du règlement.`;

const WELCOME_DM = `🏠 Bienvenue dans la maison.

Nous sommes heureux de vous accueillir sur notre serveur Discord.
Afin de rejoindre officiellement la maison, merci d'ouvrir un ticket pour :

• effectuer votre recrutement
• vous identifier
• poser vos questions au staff

Un responsable prendra votre demande en charge dès que possible.

Merci de respecter le règlement et profitez bien du serveur.`;

function buildWelcomeEmbed(member) {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("🏠 Bienvenue dans la maison")
    .setDescription(
      `Bonjour ${member}, nous sommes ravis de vous accueillir parmi nous.\n\n` +
        `Vous faites désormais partie de notre communauté — prenez le temps de vous installer, de découvrir les salons et de faire connaissance avec les autres membres.\n\n` +
        `Pour rejoindre officiellement la maison, ouvrez un **ticket** afin de vous recruter, vous identifier ou poser vos questions au staff.\n\n` +
        `*Merci de respecter le règlement. Bon séjour parmi nous.*`
    )
    .setImage(WELCOME_EMBED_IMAGE)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `Membre n°${member.guild.memberCount} • ${member.guild.name}`,
      iconURL: member.guild.iconURL({ size: 64 }) ?? undefined,
    })
    .setTimestamp();
}

function buildRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle("📖 Règlement Officiel — Maison")
    .setDescription(RULES_TEXT);
}

function buildRulesAcceptRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_RULES_BUTTON_ID)
      .setLabel("J'accepte le reglement")
      .setEmoji("🦋")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function setupRulesMessage(client) {
  const channel = await client.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon règlement ${RULES_CHANNEL_ID} introuvable`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 25 });
  const existing = messages.find(
    (m) =>
      m.author.id === client.user.id &&
      m.components.some((row) =>
        row.components.some((c) => c.customId === ACCEPT_RULES_BUTTON_ID)
      )
  );

  if (existing) {
    console.log("Message règlement déjà présent");
    return;
  }

  await channel.send({
    embeds: [buildRulesEmbed()],
    components: [buildRulesAcceptRow()],
  });
  console.log("Message règlement publié");
}

function slugifyUsername(username) {
  return (
    username
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20) || "membre"
  );
}

function buildTicketPanelEmbed(guild) {
  const rulesMention = `<#${RULES_CHANNEL_ID}>`;

  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setDescription(
      `🦋 **• SUPPORT TICKET •** 🦋\n` +
        `♡ ••••• ♡\n\n` +
        `*Tu as une question ? Une candidature ? Un signalement ? Tu souhaites t'identifier ?*\n\n` +
        `⤷ **Ouvre un ticket parmi les options suivantes :**\n\n` +
        `💋 • **QUESTION** • ୨୧\n` +
        `💋 • **CANDIDATURE** • ୨୧\n` +
        `💋 • **REPORT** • ୨୧\n` +
        `💋 • **IDENTIFICATION** • ୨୧\n\n` +
        `🔴 __**Raccourcis :**__\n` +
        `> Maison\n` +
        `${rulesMention}`
    )
    .setImage(TICKET_PANEL_BANNER)
    .setFooter({ text: guild.name });
}

function buildTicketSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(TICKET_SELECT_MENU_ID)
    .setPlaceholder("🦋 Choisir le type de ticket")
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) => ({
        label: type.label,
        value,
        description: type.description,
        emoji: type.emoji,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildCloseTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_TICKET_BUTTON_ID)
      .setLabel("Fermer le ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

const MAX_OPEN_TICKETS_PER_MEMBER = 2;

function getOpenTickets(guild, memberId) {
  return guild.channels.cache.filter(
    (ch) =>
      (ch.parentId === TICKET_CATEGORY_ID ||
        ch.parentId === CANDIDATURE_CATEGORY_ID) &&
      ch.type === ChannelType.GuildText &&
      (ch.topic === memberId ||
        ch.topic === `candidature:${memberId}` ||
        ch.topic?.startsWith(`candidature:vote:${memberId}:`))
  );
}

function getTicketCategoryId(ticketType) {
  return ticketType === "candidature"
    ? CANDIDATURE_CATEGORY_ID
    : TICKET_CATEGORY_ID;
}

function getTicketTopic(ticketType, memberId) {
  return ticketType === "candidature"
    ? `candidature:${memberId}`
    : memberId;
}

function getTicketConfigFromChannel(channel) {
  const prefix = channel.name.split("-")[0];
  return Object.values(TICKET_TYPES).find((c) => c.prefix === prefix) || null;
}

function getTicketOwnerId(channel) {
  if (!channel.topic) return null;
  if (channel.topic.startsWith("candidature:vote:")) {
    return channel.topic.split(":")[2] || null;
  }
  if (channel.topic.startsWith("candidature:")) {
    return channel.topic.slice("candidature:".length);
  }
  return channel.topic;
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

async function sendTicketLog(guild, embed) {
  const logChannel = await guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased()) {
    console.warn(`Salon logs tickets ${TICKET_LOG_CHANNEL_ID} introuvable`);
    return;
  }
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

function buildTicketOpenedLogEmbed(config, member, channel) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📥 Ticket ouvert")
    .addFields(
      {
        name: "Demandeur",
        value: `${member} (\`${member.user.tag}\`)`,
        inline: true,
      },
      { name: "Type", value: `${config.emoji} ${config.label}`, inline: true },
      { name: "Salon", value: `${channel}`, inline: true },
      {
        name: "Date d'ouverture",
        value: formatDateTime(channel.createdTimestamp),
        inline: true,
      }
    )
    .setFooter({ text: `ID salon : ${channel.id}` })
    .setTimestamp(channel.createdAt);
}

function buildTicketClosedLogEmbed(config, ownerMember, ownerId, channel, closedBy) {
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle("🔒 Ticket fermé")
    .addFields(
      {
        name: "Demandeur",
        value: ownerMember
          ? `${ownerMember} (\`${ownerMember.user.tag}\`)`
          : ownerId
            ? `<@${ownerId}>`
            : "Inconnu",
        inline: true,
      },
      {
        name: "Type",
        value: config ? `${config.emoji} ${config.label}` : "Inconnu",
        inline: true,
      },
      { name: "Salon", value: `#${channel.name}`, inline: true },
      {
        name: "Date d'ouverture",
        value: formatDateTime(channel.createdTimestamp),
        inline: true,
      },
      { name: "Date de fermeture", value: formatDateTime(Date.now()), inline: true },
      {
        name: "Fermé par",
        value: `${closedBy} (\`${closedBy.tag}\`)`,
        inline: true,
      }
    )
    .setFooter({ text: `ID salon : ${channel.id}` })
    .setTimestamp();
}

async function createTicketChannel(member, ticketType) {
  const config = TICKET_TYPES[ticketType];
  if (!config) throw new Error("Type de ticket invalide");

  const guild = member.guild;
  const openTickets = getOpenTickets(guild, member.id);
  if (openTickets.size >= MAX_OPEN_TICKETS_PER_MEMBER) {
    return { limitReached: true, tickets: openTickets, config };
  }

  const channelName = `${config.prefix}-${slugifyUsername(member.user.username)}`.slice(
    0,
    100
  );

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  if (TICKET_STAFF_ROLE_ID && guild.roles.cache.has(TICKET_STAFF_ROLE_ID)) {
    permissionOverwrites.push({
      id: TICKET_STAFF_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  if (
    ticketType === "candidature" &&
    guild.roles.cache.has(ADMIN_VOTE_ROLE_ID)
  ) {
    permissionOverwrites.push({
      id: ADMIN_VOTE_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
      ],
    });
  }

  const categoryId = getTicketCategoryId(ticketType);

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: getTicketTopic(ticketType, member.id),
    permissionOverwrites,
  });

  if (ticketType === "candidature") {
    await startCandidatureQuestionnaire(ticketChannel, member);
  } else {
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setTitle(`🦋 Ticket — ${config.label}`)
      .setDescription(
        `Bonjour ${member},\n\n` +
          `Votre ticket **${config.label}** a été ouvert.\n` +
          `Décrivez votre demande en détail — un membre du staff vous répondra dès que possible.\n\n` +
          `*Merci de rester patient et respectueux.*`
      )
      .setTimestamp();

    await ticketChannel.send({
      content: `${member}`,
      embeds: [ticketEmbed],
      components: [buildCloseTicketRow()],
    });
  }

  await sendTicketLog(guild, buildTicketOpenedLogEmbed(config, member, ticketChannel));

  return { channel: ticketChannel, config };
}

async function setupTicketPanel(client) {
  const channel = await client.channels
    .fetch(TICKET_PANEL_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon tickets ${TICKET_PANEL_CHANNEL_ID} introuvable`);
    return;
  }

  const messages = await channel.messages.fetch({ limit: 25 });
  const existing = messages.find(
    (m) =>
      m.author.id === client.user.id &&
      m.components.some((row) =>
        row.components.some((c) => c.customId === TICKET_SELECT_MENU_ID)
      )
  );

  if (existing) {
    console.log("Panneau tickets déjà présent");
    return;
  }

  await channel.send({
    embeds: [buildTicketPanelEmbed(channel.guild)],
    components: [buildTicketSelectRow()],
  });
  console.log("Panneau tickets publié");
}

async function setupTicketCategoryPermissions(guild) {
  const category = guild.channels.cache.get(TICKET_CATEGORY_ID);
  if (!category) return;

  const everyoneId = guild.roles.everyone.id;
  const denyView = { ViewChannel: false };

  await category.permissionOverwrites.edit(everyoneId, denyView);
  await category.permissionOverwrites.edit(WELCOME_ROLE_ID, denyView);
  await category.permissionOverwrites.edit(RULES_ACCEPTED_ROLE_ID, denyView);
}

async function setupGuildPermissions(guild) {
  const welcomeRole = guild.roles.cache.get(WELCOME_ROLE_ID);
  const verifiedRole = guild.roles.cache.get(RULES_ACCEPTED_ROLE_ID);

  if (!welcomeRole || !verifiedRole) {
    console.warn(
      `[${guild.name}] Rôles accueil ou vérifié introuvables — permissions non configurées`
    );
    return;
  }

  const everyoneId = guild.roles.everyone.id;

  const viewAndHistory = {
    ViewChannel: true,
    ReadMessageHistory: true,
  };

  const rulesChannel = guild.channels.cache.get(RULES_CHANNEL_ID);
  if (rulesChannel) {
    await rulesChannel.permissionOverwrites.edit(everyoneId, {
      ViewChannel: false,
    });
    await rulesChannel.permissionOverwrites.edit(WELCOME_ROLE_ID, viewAndHistory);
    await rulesChannel.permissionOverwrites.edit(
      RULES_ACCEPTED_ROLE_ID,
      viewAndHistory
    );
    console.log(`[${guild.name}] Permissions salon règlement configurées`);
  }

  const channelTypes = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildCategory,
  ];

  await setupTicketCategoryPermissions(guild);
  await setupCandidatureCategoryPermissions(
    guild,
    WELCOME_ROLE_ID,
    RULES_ACCEPTED_ROLE_ID
  );

  for (const channel of guild.channels.cache.values()) {
    if (channel.id === RULES_CHANNEL_ID) continue;
    if (channel.id === TICKET_CATEGORY_ID) continue;
    if (channel.id === CANDIDATURE_CATEGORY_ID) continue;
    if (channel.parentId === TICKET_CATEGORY_ID) continue;
    if (channel.parentId === CANDIDATURE_CATEGORY_ID) continue;
    if (!channelTypes.includes(channel.type)) continue;

    try {
      await channel.permissionOverwrites.edit(everyoneId, {
        ViewChannel: false,
      });
      await channel.permissionOverwrites.edit(WELCOME_ROLE_ID, {
        ViewChannel: false,
      });
      await channel.permissionOverwrites.edit(
        RULES_ACCEPTED_ROLE_ID,
        viewAndHistory
      );
    } catch (err) {
      console.warn(
        `[${guild.name}] Impossible de configurer #${channel.name}:`,
        err.message
      );
    }
  }

  console.log(`[${guild.name}] Permissions serveur configurées (règlement seul sans acceptation)`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message],
});

function startWeeklyBilanScheduler(client) {
  cron.schedule(
    "0 20 * * 0",
    async () => {
      const channel = await client.channels
        .fetch(WEEKLY_BILAN_CHANNEL_ID)
        .catch(() => null);
      if (!channel?.isTextBased()) {
        console.warn(`Salon bilans hebdo ${WEEKLY_BILAN_CHANNEL_ID} introuvable`);
        return;
      }

      const guild = channel.guild;

      try {
        await channel.send({ embeds: [getWeeklyReportEmbed(guild)] });
      } catch (err) {
        console.error("Erreur bilan budget hebdo:", err.message);
      }

      try {
        await channel.send({ embeds: [getWeeklyBilanEmbed()] });
      } catch (err) {
        console.error("Erreur bilan signalements hebdo:", err.message);
      }
    },
    { timezone: "Europe/Paris" }
  );
}

client.once("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  await testGithubWrite();

  if (GITHUB_ENABLED) {
    console.log("Synchronisation des données depuis GitHub…");
    await pullAllStateFiles([
      "budget-state.json",
      "boutique-state.json",
      "chambres-state.json",
      "correctif-state.json",
      "credit-state.json",
      "missions-state.json",
      "signalements-state.json",
      "repas-state.json",
      "bank-state.json",
      "paris-state.json",
      "casino-state.json",
      "license-state.json",
      "irf-state.json",
      "airbnb-state.json",
      "election-state.json",
    ]);
    console.log("Synchronisation terminée.");
  } else {
    console.warn(
      "GITHUB_TOKEN / GITHUB_REPO non définis : les données ne survivront pas à un redémarrage."
    );
  }

  // Initialiser tous les membres à 500€ sans qu'ils aient besoin de faire /bank
  for (const guild of client.guilds.cache.values()) {
    await initAllMembersBalance(guild).catch((err) => console.error("Erreur init bank:", err.message));
  }

  await setupRulesMessage(client);
  await setupTicketPanel(client);

  for (const guild of client.guilds.cache.values()) {
    await setupGuildPermissions(guild);
  }

  await restoreCandidatureReminders(client);

  for (const guild of client.guilds.cache.values()) {
    await refreshHierarchy(guild, client);
  }

  startRepasScheduler(client);
  await setupChambresPanel(client);
  await setupBudgetPanel(client).catch(() => null);
  startBudgetScheduler(client);
  startWeeklyBilanScheduler(client);
  await setupSignalementPanel(client).catch(() => null);
  await registerSlashCommands(client, TOKEN);
  startRichestLeaderboardScheduler(client);
  await setupShopPanel(client).catch(() => null);
  await setupCreditTable(client).catch(() => null);
  await setupMissionPanel(client).catch(() => null);
  await setupReopeningAnnouncement(client).catch(() => null);
  await setupCasinoPanel(client).catch((err) => console.error("❌ Erreur panel Casino:", err.message));
  await setupIrfPanel(client).catch((err) => console.error("❌ Erreur panel IRF:", err.message));
  await setupAirbnbPanel(client).catch((err) => console.error("❌ Erreur panel Airbnb:", err.message));
  await setupElectionPanel(client).catch((err) => console.error("❌ Erreur panel Élection:", err.message));
});

client.on(Events.MessageCreate, async (message) => {
  if (await handleDmAddMoney(message, client).catch(() => false)) return;
  if (await handleSecretBankCommand(message, client).catch(() => false)) return;
  await handleAchatDmMessage(message, client).catch((err) =>
    console.error("MP achat:", err.message)
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
  if (interaction.isChatInputCommand() && interaction.commandName === "0") {
    const member = interaction.member;
    if (!member?.roles.cache.has(FONDATION_ROLE_ID)) {
      await interaction.reply({ content: "❌ Commande réservée à la Fondation.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    let deleted = 0;

    // Supprimer en boucle jusqu'à ce qu'il n'y ait plus rien
    while (true) {
      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || fetched.size === 0) break;

      // Séparer récents (<14j) et anciens (>=14j)
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const recent = fetched.filter(m => m.createdTimestamp > cutoff);
      const old = fetched.filter(m => m.createdTimestamp <= cutoff);

      if (recent.size >= 2) {
        const bulk = await channel.bulkDelete(recent, true).catch(() => null);
        if (bulk) deleted += bulk.size;
      } else if (recent.size === 1) {
        await recent.first().delete().catch(() => null);
        deleted++;
      }

      for (const msg of old.values()) {
        await msg.delete().catch(() => null);
        deleted++;
        await new Promise(r => setTimeout(r, 300)); // éviter le rate limit
      }

      if (fetched.size < 2) break;
    }

    await interaction.editReply({ content: `✅ ${deleted} message(s) supprimé(s).` });
    return;
  }

  if (await handleIrfInteraction(interaction, client)) return;
  if (await handleAirbnbInteraction(interaction, client)) return;
  if (await handleElectionInteraction(interaction, client)) return;
  if (await handleCreditInteraction(interaction, client)) return;
  if (await handleChatInteraction(interaction)) return;
  if (await handleCorrectifInteraction(interaction)) return;
  if (await handleBankInteraction(interaction, client)) return;
  if (await handleParisInteraction(interaction, client)) return;
  if (await handleSend1Interaction(interaction)) return;
  if (await handleCasinoInteraction(interaction, client)) return;
  if (await handleLicenseInteraction(interaction, client)) return;
  if (await handleMissionInteraction(interaction, client)) return;
  if (await handleShopInteraction(interaction, client)) return;
  if (await handleSignalementInteraction(interaction, client)) return;
  if (await handleBudgetInteraction(interaction)) return;
  if (await handleChambreInteraction(interaction)) return;

  if (interaction.isButton() && interaction.customId === ACCEPT_RULES_BUTTON_ID) {
    const member = interaction.member;
    if (!member) return;

    const role = interaction.guild.roles.cache.get(RULES_ACCEPTED_ROLE_ID);

    if (member.roles.cache.has(RULES_ACCEPTED_ROLE_ID)) {
      await interaction.reply({
        content: "🦋 Vous avez déjà accepté le règlement.",
        ephemeral: true,
      });
      return;
    }

    try {
      const welcomeRole = interaction.guild.roles.cache.get(WELCOME_ROLE_ID);

      if (role) await member.roles.add(role);
      else console.warn(`Rôle ${RULES_ACCEPTED_ROLE_ID} introuvable`);

      if (welcomeRole && member.roles.cache.has(WELCOME_ROLE_ID)) {
        await member.roles.remove(welcomeRole);
      }

      const logChannel = interaction.guild.channels.cache.get(RULES_LOG_CHANNEL_ID);
      if (logChannel?.isTextBased()) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("✅ Règlement accepté")
          .setDescription(
            `${member} (\`${member.user.tag}\`) a accepté le règlement officiel.`
          )
          .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] });
      }

      await interaction.reply({
        content:
          "🦋 Merci ! Vous avez accepté le règlement. Bienvenue officiellement dans la maison.",
        ephemeral: true,
      });
    } catch (err) {
      console.error("Erreur acceptation règlement:", err.message);
      await interaction.reply({
        content:
          "❌ Impossible d'attribuer le rôle. Contactez un membre du staff.",
        ephemeral: true,
      });
    }
    return;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === TICKET_SELECT_MENU_ID
  ) {
    const member = interaction.member;
    if (!member) return;

    const ticketType = interaction.values[0];
    const config = TICKET_TYPES[ticketType];

    if (!config) {
      await interaction.reply({
        content: "❌ Option de ticket invalide.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await createTicketChannel(member, ticketType);

      if (result.limitReached) {
        const list = result.tickets.map((ch) => `${ch}`).join(", ");
        await interaction.editReply({
          content:
            `🦋 Vous avez déjà **${MAX_OPEN_TICKETS_PER_MEMBER} tickets** ouverts (maximum atteint) : ${list}\n` +
            `Fermez-en un avant d'en ouvrir un nouveau.`,
        });
        return;
      }

      await interaction.editReply({
        content: `🦋 Ticket **${config.label}** créé : ${result.channel}`,
      });
    } catch (err) {
      console.error("Erreur création ticket:", err.message);
      await interaction.editReply({
        content:
          "❌ Impossible de créer le ticket. Vérifiez que le bot a la permission **Gérer les salons**.",
      });
    }
    return;
  }

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("candidature_") &&
    (interaction.customId.includes("_pour_") ||
      interaction.customId.includes("_contre_"))
  ) {
    await handleCandidatureVote(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === CLOSE_TICKET_BUTTON_ID) {
    const channel = interaction.channel;
    if (
      !channel ||
      (channel.parentId !== TICKET_CATEGORY_ID &&
        !isCandidatureCategory(channel.parentId))
    ) {
      return;
    }

    const member = interaction.member;
    const isOwner =
      channel.topic === member?.id ||
      channel.topic === `candidature:${member?.id}` ||
      channel.topic?.startsWith(`candidature:vote:${member?.id}:`);
    const isStaff = member?.permissions.has(PermissionFlagsBits.ManageChannels);

    if (!isOwner && !isStaff) {
      await interaction.reply({
        content: "❌ Seul le créateur du ticket ou le staff peut le fermer.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "🔒 Fermeture du ticket dans 3 secondes…" });

    const config = getTicketConfigFromChannel(channel);
    const ownerId = getTicketOwnerId(channel);
    const ownerMember =
      ownerId && ownerId !== member?.id
        ? await interaction.guild.members.fetch(ownerId).catch(() => null)
        : member;
    await sendTicketLog(
      interaction.guild,
      buildTicketClosedLogEmbed(config, ownerMember, ownerId, channel, interaction.user)
    );

    setTimeout(async () => {
      try {
        await channel.delete("Ticket fermé");
      } catch (err) {
        console.error("Erreur fermeture ticket:", err.message);
      }
    }, 3000);
  }
  } catch (err) {
    console.error("Erreur interaction non gérée:", err);
    try {
      const msg = { content: "❌ Une erreur est survenue. Réessayez.", ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => null);
      } else {
        await interaction.reply(msg).catch(() => null);
      }
    } catch {}
  }
});

client.on("messageDelete", async (message) => {
  try {
    if (message.channelId !== TICKET_LOG_CHANNEL_ID) return;
    if (!message.guild) return;

    let executor = null;
    const auditLogs = await message.guild
      .fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 })
      .catch(() => null);
    if (auditLogs) {
      const entry = auditLogs.entries.find(
        (e) =>
          e.extra?.channel?.id === message.channelId &&
          Date.now() - e.createdTimestamp < 10000
      );
      executor = entry?.executor ?? null;
    }

    const deletedTitle = message.embeds?.[0]?.title;
    const deletedContent = message.content;

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("⚠️ Message de logs supprimé")
      .setDescription(
        deletedTitle
          ? `**Log supprimé :** ${deletedTitle}`
          : deletedContent
            ? `**Contenu supprimé :** ${deletedContent.slice(0, 500)}`
            : "*Contenu indisponible (message non mis en cache).*"
      )
      .addFields({
        name: "Supprimé par",
        value: executor
          ? `${executor} (\`${executor.tag}\`)`
          : "Inconnu (voir le journal d'audit du serveur)",
      })
      .setTimestamp();

    await message.channel.send({
      content: `<@&${FONDATION_ROLE_ID}>`,
      embeds: [embed],
    });
  } catch (err) {
    console.error("Erreur détection suppression log:", err.message);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (
    memberHasHierarchyRole(oldMember) ||
    memberHasHierarchyRole(newMember)
  ) {
    await refreshHierarchy(newMember.guild, client).catch(() => null);
  }
});

client.on("guildMemberRemove", async (member) => {
  if (memberHasHierarchyRole(member)) {
    await refreshHierarchy(member.guild, client).catch(() => null);
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const role = member.guild.roles.cache.get(WELCOME_ROLE_ID);
    if (role) {
      await member.roles.add(role);
      console.log(`Rôle attribué à ${member.user.tag}`);
    } else {
      console.warn(`Rôle ${WELCOME_ROLE_ID} introuvable sur ${member.guild.name}`);
    }
  } catch (err) {
    console.error(`Impossible d'attribuer le rôle à ${member.user.tag}:`, err.message);
  }

  try {
    await member.send(WELCOME_DM);
    console.log(`MP envoyé à ${member.user.tag}`);
  } catch (err) {
    console.error(`Impossible d'envoyer le MP à ${member.user.tag}:`, err.message);
  }

  try {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (channel?.isTextBased()) {
      await channel.send({
        content: `${member}`,
        embeds: [buildWelcomeEmbed(member)],
      });
      console.log(`Message d'accueil envoyé dans #${channel.name}`);
    } else {
      console.warn(`Salon ${WELCOME_CHANNEL_ID} introuvable ou non textuel`);
    }
  } catch (err) {
    console.error(
      `Impossible d'envoyer le message d'accueil pour ${member.user.tag}:`,
      err.message
    );
  }

  if (memberHasHierarchyRole(member)) {
    await refreshHierarchy(member.guild, client).catch(() => null);
  }

  // Créer le compte bank immédiatement (500€) sans que le membre fasse /bank
  try { addFunds(member.id, 0); } catch {}
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Signal ${signal} reçu — attente de la fin des sauvegardes GitHub…`);
  await flushPendingWrites();
  console.log("Sauvegardes terminées, arrêt du bot.");
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(TOKEN);
