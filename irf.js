const fs = require("fs");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const { getBalance, addFunds, removeFunds, formatEuro } = require("./bank");

const IRF_CHANNEL_ID = "1527524719094534185";
const IRF_ROLE_ID = "1527525759793762586";
const BANK_STATE_FILE = getStatePath("bank-state.json");
const IRF_STATE_FILE = getStatePath("irf-state.json");
const TRANSACTION_LOG_CHANNEL_ID = "1510687492896981102";

// Préfixes boutons
const BTN_COMPTES = "irf_comptes";
const BTN_GELER = "irf_geler";
const BTN_DEGELER = "irf_degeler";
const BTN_TRANSACTIONS = "irf_transactions";
const BTN_AMENDE = "irf_amende";
const BTN_AIDE = "irf_aide";
const BTN_TRESORERIE = "irf_tresorerie";
const SELECT_GELER = "irf_select_geler";
const SELECT_DEGELER = "irf_select_degeler";
const SELECT_TRANSACTIONS = "irf_select_tx";
const SELECT_AMENDE = "irf_select_amende";
const SELECT_AIDE = "irf_select_aide";
const MODAL_AMENDE = "irf_modal_amende_";
const MODAL_AIDE = "irf_modal_aide_";

function round2(n) { return Math.round(n * 100) / 100; }

function isIRF(member) {
  return member?.roles.cache.has(IRF_ROLE_ID) ?? false;
}

function loadBankState() {
  try {
    return JSON.parse(fs.readFileSync(BANK_STATE_FILE, "utf8"));
  } catch {
    return { balances: {}, frozenAccounts: {} };
  }
}

function saveBankState(state) {
  fs.writeFileSync(BANK_STATE_FILE, JSON.stringify(state, null, 2));
  persistState("bank-state.json");
}

function loadIrfState() {
  try {
    return JSON.parse(fs.readFileSync(IRF_STATE_FILE, "utf8"));
  } catch {
    return { messageId: null, transactions: [] };
  }
}

function saveIrfState(state) {
  fs.writeFileSync(IRF_STATE_FILE, JSON.stringify(state, null, 2));
  persistState("irf-state.json");
}

function isAccountFrozen(userId) {
  const state = loadBankState();
  return !!(state.frozenAccounts && state.frozenAccounts[userId]);
}

function freezeAccount(userId, reason, byId) {
  const state = loadBankState();
  if (!state.frozenAccounts) state.frozenAccounts = {};
  state.frozenAccounts[userId] = { reason, frozenBy: byId, frozenAt: Date.now() };
  saveBankState(state);
}

function unfreezeAccount(userId) {
  const state = loadBankState();
  if (!state.frozenAccounts) return;
  delete state.frozenAccounts[userId];
  saveBankState(state);
}

function logIrfTransaction(entry) {
  const state = loadIrfState();
  state.transactions = [entry, ...(state.transactions || [])].slice(0, 200);
  saveIrfState(state);
}

function buildIrfPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x2980b9)
    .setTitle("🏛️ IRF — Institut de Régulation Financière")
    .setDescription(
      "Panneau de gestion des comptes bancaires de la Maison.\n\n" +
      "**🔍 Comptes** — Liste de tous les comptes et soldes\n" +
      "**🔒 Geler** — Bloquer un compte (enquête)\n" +
      "**🔓 Dégeler** — Débloquer un compte\n" +
      "**📋 Transactions** — Historique d'un membre\n" +
      "**💸 Amende** — Infliger une amende financière\n" +
      "**🤝 Aide** — Attribuer une aide financière\n" +
      "**🏛️ Trésorerie** — Taxes & flux casino"
    )
    .setFooter({ text: "Accès réservé au rôle IRF" })
    .setTimestamp();
}

function buildIrfPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_COMPTES).setLabel("Comptes").setEmoji("🔍").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_GELER).setLabel("Geler").setEmoji("🔒").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(BTN_DEGELER).setLabel("Dégeler").setEmoji("🔓").setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_TRANSACTIONS).setLabel("Transactions").setEmoji("📋").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BTN_AMENDE).setLabel("Amende").setEmoji("💸").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(BTN_AIDE).setLabel("Aide financière").setEmoji("🤝").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BTN_TRESORERIE).setLabel("Trésorerie").setEmoji("🏛️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function buildComptesEmbed(guild) {
  const state = loadBankState();
  const balances = state.balances || {};
  const frozen = state.frozenAccounts || {};

  // Trier par solde décroissant
  const entries = Object.entries(balances).sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return new EmbedBuilder().setColor(0x2980b9).setTitle("🔍 Liste des comptes").setDescription("Aucun compte enregistré.");
  }

  const lines = [];
  for (const [userId, balance] of entries) {
    let member;
    try { member = await guild.members.fetch(userId); } catch { /* inconnu */ }
    const name = member ? `${member.user.username}` : `<@${userId}>`;
    const gelé = frozen[userId] ? " 🔒" : "";
    lines.push(`${gelé}**${name}** — ${formatEuro(balance)}`);
  }

  // Découper en pages de 20
  const page = lines.slice(0, 20).join("\n");
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return new EmbedBuilder()
    .setColor(0x2980b9)
    .setTitle(`🔍 Liste des comptes (${entries.length})`)
    .setDescription(page + (lines.length > 20 ? `\n…et ${lines.length - 20} autres` : ""))
    .addFields({ name: "💰 Total en circulation", value: formatEuro(total), inline: true })
    .setFooter({ text: "🔒 = compte gelé" })
    .setTimestamp();
}

function buildTransactionsEmbed(userId, username) {
  const irfState = loadIrfState();
  const txs = (irfState.transactions || []).filter(t => t.userId === userId).slice(0, 10);

  if (txs.length === 0) {
    return new EmbedBuilder()
      .setColor(0x2980b9)
      .setTitle(`📋 Transactions — ${username}`)
      .setDescription("Aucune transaction IRF trouvée pour ce membre.");
  }

  const lines = txs.map(t => {
    const date = new Date(t.at).toLocaleDateString("fr-FR");
    const sign = t.amount > 0 ? "+" : "";
    return `\`${date}\` ${t.type} — **${sign}${formatEuro(t.amount)}** (par <@${t.byId}>)`;
  });

  return new EmbedBuilder()
    .setColor(0x2980b9)
    .setTitle(`📋 Transactions IRF — ${username}`)
    .setDescription(lines.join("\n"))
    .addFields({ name: "Solde actuel", value: formatEuro(getBalance(userId)), inline: true })
    .setTimestamp();
}

function buildTresorerieEmbed() {
  const { getBalance, formatEuro, TREASURY_ACCOUNT_ID } = require("./bank");
  const irfState = loadIrfState();

  // Dernières 15 entrées de taxes et casino (tout ce qui est byId="casino" ou type contient "Taxe")
  const allTx = (irfState.transactions || [])
    .filter(t => t.byId === "casino" || (t.type && t.type.includes("Taxe")) || (t.type && t.type.includes("Dépôt")))
    .slice(0, 15);

  const lines = allTx.map(t => {
    const date = new Date(t.at).toLocaleDateString("fr-FR");
    const sign = t.amount > 0 ? "+" : "";
    const who = t.userId === TREASURY_ACCOUNT_ID ? "Trésor" : `<@${t.userId}>`;
    return `\`${date}\` ${t.type} — **${sign}${formatEuro(t.amount)}** [${who}]`;
  });

  // Calcul total casino (gains - pertes = flux net sortant de la banque vers les joueurs)
  const casinoTx = (irfState.transactions || []).filter(t => t.byId === "casino");
  const casinoNet = round2(casinoTx.reduce((s, t) => s + (t.amount || 0), 0));

  const tresorBalance = getBalance(TREASURY_ACCOUNT_ID);

  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("🏛️ Trésorerie — Flux financiers")
    .setDescription(lines.length > 0 ? lines.join("\n") : "Aucun flux enregistré.")
    .addFields(
      { name: "💰 Solde Trésorerie", value: formatEuro(tresorBalance), inline: true },
      { name: "🎰 Flux casino net (joueurs)", value: `${casinoNet >= 0 ? "+" : ""}${formatEuro(casinoNet)}`, inline: true },
    )
    .setFooter({ text: "Taxes des virements, dépôts et résultats casino" })
    .setTimestamp();
}

async function setupIrfPanel(client) {
  const channel = await client.channels.fetch(IRF_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadIrfState();
  const payload = { embeds: [buildIrfPanelEmbed()], components: buildIrfPanelComponents() };

  // Essayer d'éditer le message existant
  if (state.messageId) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      console.log("Panel IRF mis à jour");
      return;
    }
  }

  // Message introuvable → en créer un nouveau
  const msg = await channel.send(payload);
  state.messageId = msg.id;
  saveIrfState(state);
  console.log("Panel IRF publié");
}

async function handleIrfInteraction(interaction, client) {
  // Commande slash setup
  if (interaction.isChatInputCommand() && interaction.commandName === "irf-setup") {
    if (!isIRF(interaction.member)) {
      await interaction.reply({ content: "❌ Accès réservé au rôle IRF.", ephemeral: true });
      return true;
    }
    await setupIrfPanel(client);
    await interaction.reply({ content: "✅ Panel IRF publié.", ephemeral: true });
    return true;
  }

  if (!interaction.isButton() && !interaction.isUserSelectMenu() && !interaction.isModalSubmit()) return false;

  // Vérifier rôle IRF sur toutes les interactions du panel
  const customId = interaction.customId || "";
  const isIrfInteraction = [
    BTN_COMPTES, BTN_GELER, BTN_DEGELER, BTN_TRANSACTIONS, BTN_AMENDE, BTN_AIDE,
    SELECT_GELER, SELECT_DEGELER, SELECT_TRANSACTIONS, SELECT_AMENDE, SELECT_AIDE,
  ].some(p => customId === p || customId.startsWith("irf_"));

  if (!isIrfInteraction) return false;

  if (!isIRF(interaction.member)) {
    await interaction.reply({ content: "❌ Accès réservé au rôle IRF.", ephemeral: true });
    return true;
  }

  // --- Bouton : trésorerie ---
  if (customId === BTN_TRESORERIE) {
    await interaction.deferReply({ ephemeral: true });
    const embed = buildTresorerieEmbed();
    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  // --- Bouton : liste des comptes ---
  if (customId === BTN_COMPTES) {
    await interaction.deferReply({ ephemeral: true });
    const embed = await buildComptesEmbed(interaction.guild);
    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  // --- Bouton : geler ---
  if (customId === BTN_GELER) {
    await interaction.reply({
      content: "🔒 Choisissez le membre dont vous voulez **geler** le compte :",
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(SELECT_GELER).setPlaceholder("Sélectionner un membre")
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select : geler ---
  if (customId === SELECT_GELER) {
    const target = interaction.users.first();
    if (!target) { await interaction.update({ content: "❌ Invalide.", components: [] }); return true; }

    if (isAccountFrozen(target.id)) {
      await interaction.update({ content: `❌ Le compte de **${target.username}** est déjà gelé.`, components: [] });
      return true;
    }

    freezeAccount(target.id, "Enquête IRF", interaction.user.id);
    logIrfTransaction({ userId: target.id, type: "🔒 Gel de compte", amount: 0, byId: interaction.user.id, at: Date.now() });

    // Log dans les transactions
    const logChan = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChan?.isTextBased()) {
      await logChan.send({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🔒 Compte gelé")
          .setDescription(`Le compte de <@${target.id}> a été **gelé** par <@${interaction.user.id}> (IRF).`)
          .setTimestamp()
        ]
      }).catch(() => null);
    }

    await interaction.update({ content: `✅ Le compte de **${target.username}** a été **gelé**.`, components: [] });
    return true;
  }

  // --- Bouton : dégeler ---
  if (customId === BTN_DEGELER) {
    const state = loadBankState();
    const frozen = state.frozenAccounts || {};
    const frozenIds = Object.keys(frozen);

    if (frozenIds.length === 0) {
      await interaction.reply({ content: "ℹ️ Aucun compte gelé actuellement.", ephemeral: true });
      return true;
    }

    await interaction.reply({
      content: "🔓 Choisissez le membre dont vous voulez **dégeler** le compte :",
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(SELECT_DEGELER).setPlaceholder("Sélectionner un membre")
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select : dégeler ---
  if (customId === SELECT_DEGELER) {
    const target = interaction.users.first();
    if (!target) { await interaction.update({ content: "❌ Invalide.", components: [] }); return true; }

    if (!isAccountFrozen(target.id)) {
      await interaction.update({ content: `❌ Le compte de **${target.username}** n'est pas gelé.`, components: [] });
      return true;
    }

    unfreezeAccount(target.id);
    logIrfTransaction({ userId: target.id, type: "🔓 Dégel de compte", amount: 0, byId: interaction.user.id, at: Date.now() });

    const logChan = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChan?.isTextBased()) {
      await logChan.send({
        embeds: [new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🔓 Compte dégelé")
          .setDescription(`Le compte de <@${target.id}> a été **dégelé** par <@${interaction.user.id}> (IRF).`)
          .setTimestamp()
        ]
      }).catch(() => null);
    }

    await interaction.update({ content: `✅ Le compte de **${target.username}** a été **dégelé**.`, components: [] });
    return true;
  }

  // --- Bouton : transactions ---
  if (customId === BTN_TRANSACTIONS) {
    await interaction.reply({
      content: "📋 Choisissez le membre dont vous voulez voir l'historique :",
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(SELECT_TRANSACTIONS).setPlaceholder("Sélectionner un membre")
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select : transactions ---
  if (customId === SELECT_TRANSACTIONS) {
    const target = interaction.users.first();
    if (!target) { await interaction.update({ content: "❌ Invalide.", components: [] }); return true; }
    const embed = buildTransactionsEmbed(target.id, target.username);
    await interaction.update({ content: "", embeds: [embed], components: [] });
    return true;
  }

  // --- Bouton : amende ---
  if (customId === BTN_AMENDE) {
    await interaction.reply({
      content: "💸 Choisissez le membre à **infliger une amende** :",
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(SELECT_AMENDE).setPlaceholder("Sélectionner un membre")
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select : amende → ouvrir modal ---
  if (customId === SELECT_AMENDE) {
    const target = interaction.users.first();
    if (!target) { await interaction.update({ content: "❌ Invalide.", components: [] }); return true; }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${MODAL_AMENDE}${target.id}`)
        .setTitle(`💸 Amende — ${target.username}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("montant").setLabel("Montant de l'amende (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 100")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("motif").setLabel("Motif").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder("Raison de l'amende...")
          )
        )
    );
    return true;
  }

  // --- Modal : amende ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_AMENDE)) {
    const targetId = customId.slice(MODAL_AMENDE.length);
    const amount = parseFloat(interaction.fields.getTextInputValue("montant").replace(",", "."));
    const motif = interaction.fields.getTextInputValue("motif");

    if (isNaN(amount) || amount <= 0) {
      await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
      return true;
    }
    if (isAccountFrozen(targetId)) {
      await interaction.reply({ content: "❌ Ce compte est gelé. Dégelez-le d'abord.", ephemeral: true });
      return true;
    }

    const currentBalance = getBalance(targetId);
    const deducted = Math.min(amount, currentBalance); // ne pas mettre en négatif
    removeFunds(targetId, deducted);
    logIrfTransaction({ userId: targetId, type: `💸 Amende (${motif})`, amount: -deducted, byId: interaction.user.id, at: Date.now() });

    const logChan = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChan?.isTextBased()) {
      await logChan.send({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("💸 Amende infligée")
          .addFields(
            { name: "Membre", value: `<@${targetId}>`, inline: true },
            { name: "Montant", value: formatEuro(deducted), inline: true },
            { name: "Motif", value: motif },
            { name: "Par", value: `<@${interaction.user.id}> (IRF)`, inline: true },
          )
          .setTimestamp()
        ]
      }).catch(() => null);
    }

    await interaction.reply({
      content: `✅ Amende de **${formatEuro(deducted)}** infligée à <@${targetId}>.\nMotif : *${motif}*`,
      ephemeral: true,
    });
    return true;
  }

  // --- Bouton : aide financière ---
  if (customId === BTN_AIDE) {
    await interaction.reply({
      content: "🤝 Choisissez le membre à qui attribuer une **aide financière** :",
      components: [new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(SELECT_AIDE).setPlaceholder("Sélectionner un membre")
      )],
      ephemeral: true,
    });
    return true;
  }

  // --- Select : aide → modal ---
  if (customId === SELECT_AIDE) {
    const target = interaction.users.first();
    if (!target) { await interaction.update({ content: "❌ Invalide.", components: [] }); return true; }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${MODAL_AIDE}${target.id}`)
        .setTitle(`🤝 Aide financière — ${target.username}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("montant").setLabel("Montant de l'aide (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 200")
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("motif").setLabel("Motif").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder("Raison de l'aide...")
          )
        )
    );
    return true;
  }

  // --- Modal : aide ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_AIDE)) {
    const targetId = customId.slice(MODAL_AIDE.length);
    const amount = parseFloat(interaction.fields.getTextInputValue("montant").replace(",", "."));
    const motif = interaction.fields.getTextInputValue("motif");

    if (isNaN(amount) || amount <= 0) {
      await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
      return true;
    }

    addFunds(targetId, amount);
    logIrfTransaction({ userId: targetId, type: `🤝 Aide (${motif})`, amount, byId: interaction.user.id, at: Date.now() });

    const logChan = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChan?.isTextBased()) {
      await logChan.send({
        embeds: [new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🤝 Aide financière attribuée")
          .addFields(
            { name: "Membre", value: `<@${targetId}>`, inline: true },
            { name: "Montant", value: formatEuro(amount), inline: true },
            { name: "Motif", value: motif },
            { name: "Par", value: `<@${interaction.user.id}> (IRF)`, inline: true },
          )
          .setTimestamp()
        ]
      }).catch(() => null);
    }

    await interaction.reply({
      content: `✅ Aide de **${formatEuro(amount)}** attribuée à <@${targetId}>.\nMotif : *${motif}*`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

function registerIrfSetupCommand() {
  return new SlashCommandBuilder()
    .setName("irf-setup")
    .setDescription("Publier le panel IRF (rôle IRF uniquement)")
    .toJSON();
}

module.exports = {
  setupIrfPanel,
  handleIrfInteraction,
  registerIrfSetupCommand,
  isAccountFrozen,
};
