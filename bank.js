const fs = require("fs");
const cron = require("node-cron");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");

const STATE_FILE = getStatePath("bank-state.json");
const IRF_STATE_FILE = getStatePath("irf-state.json");
const DEFAULT_BALANCE = 500;
/** Compte "Banque de la Maison" : reçoit toutes les taxes (démarre à 0, pas à 500). */
const TREASURY_ACCOUNT_ID = "1509969106999443678";
const TAX_RATE = 0.25;
const DEPOSIT_TAX_RATE = 0.05; // taxe sur les dépôts validés par la Fondation
const TRANSACTION_LOG_CHANNEL_ID = "1510687492896981102";
const FONDATION_ROLE_ID = "1509974377267990659";
const IRF_ROLE_ID = "1527525759793762586";
const AVERT_ROLES = {
  1: "1527733143564714076",
  2: "1527733237454209054",
  3: "1527733343192354927",
};
const BLACKLIST_CASINO_ROLE_ID = "1527733472704073900";
const BLACKLIST_BANK_ROLE_ID = "1527734115871490229";
const RICHEST_CHANNEL_ID = "1510702663535296623";
const RICHEST_TOP = 5;
const RICHEST_TITLE = "💰 Classement — Les plus riches";
const BTN_REFRESH_RICHEST = "bank_refresh_richest";
const DEPOSIT_ACCEPT_PREFIX = "bank_deposit_accept_";
const DEPOSIT_REFUSE_PREFIX = "bank_deposit_refuse_";
const DEPOSIT_SENT_PREFIX = "bank_deposit_sent_";
const DEPOSIT_CATEGORY_ID = "1509977402485510345";
const DEPOSIT_IBAN = "FR6410096988618TN3F7PCVDZ96";
const DEPOSIT_FONDATION2_ROLE_ID = "1509979964651343993";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.balances || typeof data.balances !== "object") data.balances = {};
    if (!data.deposits || typeof data.deposits !== "object") data.deposits = {};
    if (data.richestMessageId === undefined) data.richestMessageId = null;
    return data;
  } catch {
    return { balances: {}, deposits: {}, richestMessageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("bank-state.json");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

/** Enregistre un dépôt validé dans irf-state.json pour que le panel IRF puisse l'afficher. */
function logIrfDeposit(userId, gross, net, validatorId) {
  try {
    let irfState = { messageId: null, transactions: [] };
    try { irfState = JSON.parse(fs.readFileSync(IRF_STATE_FILE, "utf8")); } catch {}
    const entry = { userId, type: "💳 Dépôt Validé", game: `brut ${formatEuro(gross)}`, amount: net, byId: validatorId, at: Date.now() };
    irfState.transactions = [entry, ...(irfState.transactions || [])].slice(0, 200);
    fs.writeFileSync(IRF_STATE_FILE, JSON.stringify(irfState, null, 2));
    persistState("irf-state.json");
  } catch {}
}

/** Applique la taxe de la maison (25%) sur un montant brut. */
function applyTax(grossAmount) {
  const tax = round2(grossAmount * TAX_RATE);
  const net = round2(grossAmount - tax);
  return { gross: round2(grossAmount), tax, net };
}

/** Applique la taxe de dépôt (5%) sur un montant brut. */
function applyDepositTax(grossAmount) {
  const tax = round2(grossAmount * DEPOSIT_TAX_RATE);
  const net = round2(grossAmount - tax);
  return { gross: round2(grossAmount), tax, net };
}

/** Crée le compte avec le solde de départ s'il n'existe pas encore.
 *  La Banque de la Maison démarre à 0 (ce n'est pas un compte membre). */
function ensureAccount(state, userId) {
  if (typeof state.balances[userId] !== "number") {
    state.balances[userId] = userId === TREASURY_ACCOUNT_ID ? 0 : DEFAULT_BALANCE;
  }
  return state.balances[userId];
}

/** Verse une taxe dans la Banque de la Maison. */
function collectTax(taxAmount, label, fromUserId) {
  if (!taxAmount || taxAmount <= 0) return;
  const result = addFunds(TREASURY_ACCOUNT_ID, taxAmount);
  // Log IRF — écriture directe dans irf-state.json (pas d'import circulaire)
  try {
    let irfState = { messageId: null, transactions: [] };
    try { irfState = JSON.parse(fs.readFileSync(IRF_STATE_FILE, "utf8")); } catch {}
    const entry = { userId: TREASURY_ACCOUNT_ID, type: "🏛️ Argent Taxe", game: label || "", amount: taxAmount, byId: fromUserId || "system", at: Date.now() };
    irfState.transactions = [entry, ...(irfState.transactions || [])].slice(0, 500);
    fs.writeFileSync(IRF_STATE_FILE, JSON.stringify(irfState, null, 2));
    persistState("irf-state.json");
  } catch {}
  return result;
}

function getTreasuryBalance() {
  const state = loadState();
  return typeof state.balances[TREASURY_ACCOUNT_ID] === "number"
    ? state.balances[TREASURY_ACCOUNT_ID]
    : 0;
}

function getBalance(userId) {
  const state = loadState();
  // Lecture seule : si le compte n'existe pas, retourner DEFAULT_BALANCE sans sauvegarder
  if (typeof state.balances[userId] === "number") return state.balances[userId];
  return DEFAULT_BALANCE;
}

function isAccountFrozen(userId) {
  const state = loadState();
  return !!(state.frozenAccounts && state.frozenAccounts[userId]);
}

/** amount peut être négatif pour retirer. Renvoie le nouveau solde. */
function addFunds(userId, amount) {
  const state = loadState();
  // Bloquer toute transaction sur un compte gelé (entrée et sortie), sauf pour la trésorerie
  if (state.frozenAccounts && state.frozenAccounts[userId] && userId !== TREASURY_ACCOUNT_ID) {
    return typeof state.balances[userId] === "number" ? state.balances[userId] : DEFAULT_BALANCE;
  }
  ensureAccount(state, userId);
  state.balances[userId] = round2(state.balances[userId] + amount);
  saveState(state);
  return state.balances[userId];
}

function removeFunds(userId, amount) {
  return addFunds(userId, -amount);
}

/** Retire des fonds même sur un compte gelé (amendes IRF, saisies). Peut mettre en négatif. */
function forceRemoveFunds(userId, amount) {
  const state = loadState();
  ensureAccount(state, userId);
  state.balances[userId] = round2(state.balances[userId] - amount);
  saveState(state);
  return state.balances[userId];
}

function hasEnough(userId, amount) {
  return getBalance(userId) >= amount;
}

/** Initialise tous les membres du serveur à DEFAULT_BALANCE s'ils n'ont pas encore de compte.
 *  Appelée au démarrage après la synchronisation GitHub. */
async function initAllMembersBalance(guild) {
  try {
    await guild.members.fetch();
    const state = loadState();
    let changed = false;
    for (const [id, member] of guild.members.cache) {
      if (member.user.bot) continue;
      if (id === TREASURY_ACCOUNT_ID) continue;
      if (typeof state.balances[id] !== "number") {
        state.balances[id] = DEFAULT_BALANCE;
        changed = true;
      }
    }
    if (changed) {
      saveState(state);
      console.log(`✅ Comptes bank initialisés pour les membres sans solde.`);
    }
  } catch (err) {
    console.error("Erreur initAllMembersBalance:", err.message);
  }
}

function buildBalanceEmbed(user, balance) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏦 Votre compte")
    .setDescription(`**${user.username}**\nSolde actuel : **${formatEuro(balance)}**`)
    .setFooter({ text: "Utilisable pour les paris sportifs et le casino" })
    .setTimestamp();
}

/** Log générique d'une transaction taxée, envoyé dans le salon de logs. */
async function logTransaction(client, { type, from, to, gross, tax, net }) {
  const channel = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("💸 Transaction")
    .addFields(
      { name: "Type", value: type, inline: true },
      { name: "Montant brut", value: formatEuro(gross), inline: true },
      { name: "Taxe (25%)", value: formatEuro(tax), inline: true },
      { name: "Montant net", value: formatEuro(net), inline: true },
      ...(from ? [{ name: "De", value: `<@${from}>`, inline: true }] : []),
      ...(to ? [{ name: "À", value: `<@${to}>`, inline: true }] : [])
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function handleBankInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "reset") {
    await handleResetCommand(interaction, client);
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "bank") {
    const balance = getBalance(interaction.user.id);
    await interaction.reply({
      embeds: [buildBalanceEmbed(interaction.user, balance)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "addmoney") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/addmoney\`.`,
        ephemeral: true,
      });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const newBalance = addFunds(target.id, amount);

    await logTransaction(client, {
      type: "🏦 Ajout manuel (/addmoney)",
      from: interaction.user.id,
      to: target.id,
      gross: amount,
      tax: 0,
      net: amount,
    });

    await interaction.reply({
      content: `✅ **${formatEuro(amount)}** ajoutés au compte de ${target} (nouveau solde : **${formatEuro(newBalance)}**).`,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "delbank") {
    if (!isFondation(interaction.member) && !interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> ou l'**IRF** peut utiliser \`/delbank\`.`,
        ephemeral: true,
      });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const current = getBalance(target.id);
    const toRemove = Math.min(amount, current); // ne descend jamais sous 0
    const newBalance = removeFunds(target.id, toRemove);

    await logTransaction(client, {
      type: "🏦 Retrait manuel (/delbank)",
      from: target.id,
      to: interaction.user.id,
      gross: toRemove,
      tax: 0,
      net: toRemove,
    });

    await interaction.reply({
      content:
        `✅ **${formatEuro(toRemove)}** retirés du compte de ${target} (nouveau solde : **${formatEuro(newBalance)}**).` +
        (toRemove < amount ? `\n⚠️ Le solde ne pouvait pas descendre sous 0, seul ${formatEuro(toRemove)} a été retiré.` : ""),
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "avertissement") {
    if (!interaction.member?.roles.cache.has(IRF_ROLE_ID) && !isFondation(interaction.member)) {
      await interaction.reply({ content: `❌ Seul l'**IRF** peut utiliser \`/avertissement\`.`, ephemeral: true });
      return true;
    }

    const target = interaction.options.getMember("membre");
    const gravite = interaction.options.getInteger("gravite", true);
    const raison = interaction.options.getString("raison", true);
    const blacklistCasino = interaction.options.getBoolean("blacklist_casino") ?? false;
    const blacklistBank = interaction.options.getBoolean("blacklist_bank") ?? false;

    if (!target) {
      await interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
      return true;
    }

    const roleId = AVERT_ROLES[gravite];
    await target.roles.add(roleId).catch(() => null);
    if (blacklistCasino) await target.roles.add(BLACKLIST_CASINO_ROLE_ID).catch(() => null);
    if (blacklistBank) await target.roles.add(BLACKLIST_BANK_ROLE_ID).catch(() => null);

    const graviteLabel = gravite === 1 ? "⚠️ Avertissement 1" : gravite === 2 ? "🔶 Avertissement 2" : "🔴 Avertissement 3";
    const extras = [
      blacklistCasino ? "🎰 Blacklist Casino" : null,
      blacklistBank ? "🏦 Blacklist Bank" : null,
    ].filter(Boolean);

    // Log dans le salon de transactions
    const logChan = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChan?.isTextBased()) {
      await logChan.send({
        embeds: [new EmbedBuilder()
          .setColor(gravite === 1 ? 0xf39c12 : gravite === 2 ? 0xe67e22 : 0xe74c3c)
          .setTitle(`${graviteLabel} attribué`)
          .addFields(
            { name: "Membre", value: `<@${target.id}>`, inline: true },
            { name: "Par", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Motif", value: raison, inline: false },
            ...(extras.length ? [{ name: "Sanctions supplémentaires", value: extras.join("\n"), inline: false }] : []),
          )
          .setTimestamp()
        ],
      });
    }

    // DM à la personne
    const u = await client.users.fetch(target.id).catch(() => null);
    if (u) {
      await u.send(
        `${graviteLabel} — **Motif :** ${raison}${extras.length ? `\n**Sanctions :** ${extras.join(", ")}` : ""}`
      ).catch(() => null);
    }

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(gravite === 1 ? 0xf39c12 : gravite === 2 ? 0xe67e22 : 0xe74c3c)
        .setTitle(`${graviteLabel} attribué`)
        .addFields(
          { name: "Membre", value: `<@${target.id}>`, inline: true },
          { name: "Motif", value: raison, inline: false },
          ...(extras.length ? [{ name: "Sanctions", value: extras.join("\n"), inline: false }] : []),
        )
        .setTimestamp()
      ],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "saisie") {
    if (!interaction.member?.roles.cache.has(IRF_ROLE_ID) && !isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seul l'**IRF** peut utiliser \`/saisie\`.`,
        ephemeral: true,
      });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);
    const raison = interaction.options.getString("raison", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const current = getBalance(target.id);
    if (current <= 0) {
      await interaction.reply({ content: `❌ Le compte de ${target} est vide.`, ephemeral: true });
      return true;
    }

    const saisi = amount;
    const newBalance = forceRemoveFunds(target.id, saisi);

    // Log dans le salon de transactions
    await logTransaction(client, {
      type: "⚖️ Saisie IRF",
      from: target.id,
      gross: saisi,
      tax: 0,
      net: saisi,
      note: raison,
    });

    // Log IRF
    const { logIrfEvent } = require("./irf-log");
    logIrfEvent({
      type: "⚖️ Saisie",
      userId: target.id,
      amount: saisi,
      byId: interaction.user.id,
      note: raison,
      date: Date.now(),
    });

    // Notif DM à la personne
    const u = await client.users.fetch(target.id).catch(() => null);
    if (u) {
      await u.send(
        `⚖️ **Saisie IRF** — **${formatEuro(saisi)}** ont été saisis sur votre compte.\n**Motif :** ${raison}\n**Saisi par :** <@${interaction.user.id}>\n**Nouveau solde :** ${formatEuro(newBalance)}`
      ).catch(() => null);
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle("⚖️ Saisie effectuée")
          .addFields(
            { name: "Membre", value: `<@${target.id}>`, inline: true },
            { name: "Montant saisi", value: `**${formatEuro(saisi)}**`, inline: true },
            { name: "Nouveau solde", value: formatEuro(newBalance), inline: true },
            { name: "Motif", value: raison, inline: false },
            { name: "Par", value: `<@${interaction.user.id}>`, inline: true },
          )
          .setTimestamp()
      ],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "virement") {
    if (interaction.member?.roles.cache.has(BLACKLIST_BANK_ROLE_ID)) {
      await interaction.reply({ content: "🚫 Votre accès bancaire est **suspendu**. Vous ne pouvez pas effectuer de virement.", ephemeral: true });
      return true;
    }

    const target = interaction.options.getUser("membre", true);
    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }
    if (target.id === interaction.user.id) {
      await interaction.reply({ content: "❌ Vous ne pouvez pas vous virer de l'argent à vous-même.", ephemeral: true });
      return true;
    }
    if (target.bot) {
      await interaction.reply({ content: "❌ Vous ne pouvez pas envoyer d'argent à un bot.", ephemeral: true });
      return true;
    }
    if (!hasEnough(interaction.user.id, amount)) {
      await interaction.reply({ content: "❌ Solde insuffisant. Vérifiez votre solde avec `/bank`.", ephemeral: true });
      return true;
    }

    const { gross, tax, net } = applyTax(amount);
    removeFunds(interaction.user.id, gross);
    addFunds(target.id, net);
    collectTax(tax, "virement", interaction.user.id);

    // Log IRF pour les deux parties
    try {
      let irfState = { messageId: null, transactions: [] };
      try { irfState = JSON.parse(fs.readFileSync(IRF_STATE_FILE, "utf8")); } catch {}
      irfState.transactions = [
        { userId: interaction.user.id, type: "🔁 Virement envoyé", game: `vers <@${target.id}>`, amount: -gross, byId: interaction.user.id, at: Date.now() },
        { userId: target.id, type: "🔁 Virement reçu", game: `de <@${interaction.user.id}>`, amount: net, byId: interaction.user.id, at: Date.now() },
        ...irfState.transactions,
      ].slice(0, 500);
      fs.writeFileSync(IRF_STATE_FILE, JSON.stringify(irfState, null, 2));
      persistState("irf-state.json");
    } catch {}

    await logTransaction(client, {
      type: "🔁 Virement (/virement)",
      from: interaction.user.id,
      to: target.id,
      gross,
      tax,
      net,
    });

    await interaction.reply({
      content:
        `✅ Virement effectué : **${formatEuro(gross)}** débités de votre compte.\n` +
        `${target} reçoit **${formatEuro(net)}** (taxe de la maison : ${formatEuro(tax)}).`,
      ephemeral: true,
    });
    return true;
  }

  // --- Demande de dépôt — crée un ticket avec IBAN ---
  if (interaction.isChatInputCommand() && interaction.commandName === "deposit") {
    if (interaction.member?.roles.cache.has(BLACKLIST_BANK_ROLE_ID)) {
      await interaction.reply({ content: "🚫 Votre accès bancaire est **suspendu**. Vous ne pouvez pas effectuer de dépôt.", ephemeral: true });
      return true;
    }

    const amount = interaction.options.getNumber("montant", true);

    if (amount <= 0) {
      await interaction.reply({ content: "❌ Le montant doit être positif.", ephemeral: true });
      return true;
    }

    const requestId = `dep_${Date.now()}`;
    const { tax, net } = applyDepositTax(amount);

    const state = loadState();
    state.deposits[requestId] = {
      userId: interaction.user.id,
      amount,
      status: "pending",
      createdAt: Date.now(),
    };
    saveState(state);

    // Créer le ticket dans la catégorie dépôt
    const category = await client.channels.fetch(DEPOSIT_CATEGORY_ID).catch(() => null);
    const guild = interaction.guild;
    const ticketChannel = await guild.channels.create({
      name: `deposit-${interaction.user.username}`,
      parent: category?.id || null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: FONDATION_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: DEPOSIT_FONDATION2_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    }).catch(() => null);

    if (!ticketChannel) {
      await interaction.reply({ content: "❌ Impossible de créer le ticket. Contactez un admin.", ephemeral: true });
      return true;
    }

    const ibanEmbed = new EmbedBuilder()
      .setColor(0x2980b9)
      .setTitle("🏦 Dépôt bancaire")
      .setDescription(
        `Bonjour <@${interaction.user.id}> !\n\n` +
        `Vous souhaitez déposer **${formatEuro(amount)}** sur votre compte.\n` +
        `Après la taxe de ${DEPOSIT_TAX_RATE * 100}%, vous recevrez **${formatEuro(net)}**.\n\n` +
        `**📋 Instructions :**\n` +
        `Effectuez un virement du montant exact vers l'IBAN ci-dessous :\n\n` +
        `\`\`\`\n${DEPOSIT_IBAN}\n\`\`\`\n` +
        `> ⚠️ Mentionnez votre pseudo Discord en référence du virement.\n\n` +
        `Une fois le virement effectué, cliquez sur le bouton **"J'ai envoyé l'argent"**.`
      )
      .addFields(
        { name: "Montant à envoyer", value: `**${formatEuro(amount)}**`, inline: true },
        { name: "Vous recevrez", value: `**${formatEuro(amount)}**`, inline: true },
      )
      .setFooter({ text: `Réf. ${requestId}` })
      .setTimestamp();

    const sentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DEPOSIT_SENT_PREFIX}${requestId}`)
        .setLabel("J'ai envoyé l'argent")
        .setEmoji("💸")
        .setStyle(ButtonStyle.Primary)
    );

    await ticketChannel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [ibanEmbed],
      components: [sentRow],
    });

    await interaction.reply({
      content: `✅ Votre ticket de dépôt a été ouvert : ${ticketChannel}`,
      ephemeral: true,
    });
    return true;
  }

  // --- Bouton "J'ai envoyé l'argent" → faux chargement 30s ---
  if (interaction.isButton() && interaction.customId.startsWith(DEPOSIT_SENT_PREFIX)) {
    const requestId = interaction.customId.slice(DEPOSIT_SENT_PREFIX.length);
    const state = loadState();
    const request = state.deposits[requestId];

    if (!request || request.status !== "pending") {
      await interaction.reply({ content: "❌ Cette demande n'est plus en attente.", ephemeral: true });
      return true;
    }
    if (interaction.user.id !== request.userId) {
      await interaction.reply({ content: "❌ Ce ticket ne vous appartient pas.", ephemeral: true });
      return true;
    }

    // Marquer comme "envoyé" pour éviter double-clic
    request.status = "sent";
    request.sentAt = Date.now();
    saveState(state);

    // Désactiver le bouton
    await interaction.update({
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${DEPOSIT_SENT_PREFIX}${requestId}`)
          .setLabel("Vérification en cours…")
          .setEmoji("🔍")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )],
    });

    // Faux chargement — messages progressifs
    const loadingMsg = await interaction.channel.send("🔍 Recherche du virement en cours…");
    await sleep(10000);
    await loadingMsg.edit("🔍 Connexion aux serveurs bancaires…").catch(() => null);
    await sleep(10000);
    await loadingMsg.edit("🔍 Vérification des transactions récentes…").catch(() => null);
    await sleep(10000);

    // Heure simulée = maintenant - aléatoire entre 1 et 5 min
    const sentTime = new Date(Date.now() - Math.floor(Math.random() * 4 + 1) * 60 * 1000);
    const heureStr = sentTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    const { tax, net } = applyDepositTax(request.amount);

    const foundEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Virement Trouvé")
      .addFields(
        { name: "🕐 Heure du virement", value: heureStr, inline: true },
        { name: "💶 Montant reçu", value: formatEuro(request.amount), inline: true },
      )
      .setTimestamp();

    const pendingEmbed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle("⏳ Ajout disponible à votre compte en bank")
      .setDescription(
        `En attente de validation par <@&${FONDATION_ROLE_ID}> ou <@&${DEPOSIT_FONDATION2_ROLE_ID}>.`
      )
      .setFooter({ text: `Réf. ${requestId}` });

    const validateRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DEPOSIT_ACCEPT_PREFIX}${requestId}`)
        .setLabel("Valider le dépôt")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${DEPOSIT_REFUSE_PREFIX}${requestId}`)
        .setLabel("Refuser")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    );

    await loadingMsg.delete().catch(() => null);
    await interaction.channel.send({
      content: `<@&${FONDATION_ROLE_ID}> <@&${DEPOSIT_FONDATION2_ROLE_ID}>`,
      embeds: [foundEmbed, pendingEmbed],
      components: [validateRow],
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(DEPOSIT_ACCEPT_PREFIX)) {
    if (!isFondation(interaction.member) && !interaction.member?.roles.cache.has(DEPOSIT_FONDATION2_ROLE_ID)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** peut valider un dépôt.`,
        ephemeral: true,
      });
      return true;
    }

    const requestId = interaction.customId.slice(DEPOSIT_ACCEPT_PREFIX.length);
    const state = loadState();
    const request = state.deposits[requestId];

    if (!request || (request.status !== "pending" && request.status !== "sent")) {
      await interaction.reply({ content: "❌ Cette demande n'est plus en attente.", ephemeral: true });
      return true;
    }

    const gross = round2(request.amount);
    addFunds(request.userId, gross);
    logIrfDeposit(request.userId, gross, gross, interaction.user.id);

    // Recharger après addFunds pour ne pas écraser les balances qu'il vient de sauvegarder
    const state2 = loadState();
    const req2 = state2.deposits[requestId];
    if (req2) {
      req2.status = "accepted";
      req2.validatedAt = Date.now();
      req2.validatorId = interaction.user.id;
    }
    saveState(state2);

    await logTransaction(client, {
      type: "🏦 Dépôt validé (/deposit)",
      to: request.userId,
      gross,
      tax: 0,
      net: gross,
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Dépôt validé")
      .addFields(
        { name: "Membre", value: `<@${request.userId}>`, inline: true },
        { name: "Validé par", value: `${interaction.user}`, inline: true },
        { name: "Montant crédité", value: `**${formatEuro(gross)}**`, inline: true },
      )
      .setTimestamp();

    await interaction.update({ content: "", embeds: [embed], components: [] });

    const user = await client.users.fetch(request.userId).catch(() => null);
    if (user) {
      await user
        .send(`✅ Votre dépôt de **${formatEuro(gross)}** a été validé et crédité sur votre compte \`/bank\`.`)
        .catch(() => null);
    }

    // Fermer le ticket après 10s
    setTimeout(async () => {
      await interaction.channel?.send("✅ Dépôt validé. Ce ticket sera fermé dans quelques secondes.").catch(() => null);
      await sleep(5000);
      await interaction.channel?.delete().catch(() => null);
    }, 3000);

    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(DEPOSIT_REFUSE_PREFIX)) {
    if (!isFondation(interaction.member) && !interaction.member?.roles.cache.has(DEPOSIT_FONDATION2_ROLE_ID)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** peut refuser un dépôt.`,
        ephemeral: true,
      });
      return true;
    }

    const requestId = interaction.customId.slice(DEPOSIT_REFUSE_PREFIX.length);
    const state = loadState();
    const request = state.deposits[requestId];

    if (!request || (request.status !== "pending" && request.status !== "sent")) {
      await interaction.reply({ content: "❌ Cette demande n'est plus en attente.", ephemeral: true });
      return true;
    }

    request.status = "refused";
    request.validatedAt = Date.now();
    request.validatorId = interaction.user.id;
    saveState(state);

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Dépôt refusé")
      .addFields(
        { name: "Membre", value: `<@${request.userId}>`, inline: true },
        { name: "Refusé par", value: `${interaction.user}`, inline: true },
        { name: "Montant", value: formatEuro(request.amount), inline: true },
      )
      .setTimestamp();

    await interaction.update({ content: "", embeds: [embed], components: [] });

    // Log dans le salon de transactions
    const logChanRefuse = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
    if (logChanRefuse?.isTextBased()) {
      await logChanRefuse.send({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("❌ Dépôt refusé")
          .addFields(
            { name: "Membre", value: `<@${request.userId}>`, inline: true },
            { name: "Refusé par", value: `<@${interaction.user.id}>`, inline: true },
            { name: "Montant demandé", value: formatEuro(request.amount), inline: true },
          )
          .setTimestamp()
        ]
      }).catch(() => null);
    }

    const user = await client.users.fetch(request.userId).catch(() => null);
    if (user) {
      await user
        .send(`❌ Votre demande de dépôt de **${formatEuro(request.amount)}** a été refusée.`)
        .catch(() => null);
    }

    // Fermer le ticket
    setTimeout(async () => {
      await interaction.channel?.send("❌ Dépôt refusé. Ce ticket sera fermé dans quelques secondes.").catch(() => null);
      await sleep(5000);
      await interaction.channel?.delete().catch(() => null);
    }, 3000);

    return true;
  }

  if (interaction.isButton() && interaction.customId === BTN_REFRESH_RICHEST) {
    if (!isFondation(interaction.member) && !interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> ou l'**IRF** peut forcer l'actualisation.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();
    await interaction.guild.members.fetch().catch(() => null);

    const state = loadState();
    const embed = buildRichestEmbed(interaction.guild, state);

    await interaction.editReply({ embeds: [embed], components: [buildRichestRefreshRow()] });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "classement-setup") {
    if (!isFondation(interaction.member) && !interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> ou l'**IRF** peut republier le classement.`,
        ephemeral: true,
      });
      return true;
    }

    await sendRichestLeaderboard(interaction.guild, client, false);
    await interaction.reply({
      content: `✅ Classement des plus riches republié dans <#${RICHEST_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

const RICH_MEDALS = ["🥇", "🥈", "🥉", "🏅", "🏅"];

function getSortedRichest(state) {
  return Object.entries(state.balances)
    .filter(([userId]) => userId !== TREASURY_ACCOUNT_ID) // la Banque n'est pas un membre
    .map(([userId, balance]) => ({ userId, balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, RICHEST_TOP);
}

function buildRichestEmbed(guild, state) {
  const ranked = getSortedRichest(state);
  const treasury =
    typeof state.balances[TREASURY_ACCOUNT_ID] === "number"
      ? state.balances[TREASURY_ACCOUNT_ID]
      : 0;

  let body;
  if (!ranked.length) {
    body = "*Aucun compte enregistré pour le moment.*";
  } else {
    body = ranked
      .map((entry, i) => {
        const medal = RICH_MEDALS[i] ?? `**${i + 1}.**`;
        const member = guild.members.cache.get(entry.userId);
        const name = member ? `${member}` : `<@${entry.userId}>`;
        return `${medal} ${name} — **${formatEuro(entry.balance)}**`;
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(RICHEST_TITLE)
    .setDescription(
      "Les membres avec le plus gros solde sur `/bank`.\n\n" + body
    )
    .addFields({
      name: "🏛️ Banque de la Maison",
      value: `**${formatEuro(treasury)}** *(cumul des taxes)*`,
    })
    .setFooter({
      text: `Top ${RICHEST_TOP} • Classement hebdomadaire (chaque dimanche)`,
    })
    .setTimestamp();
}

function buildRichestRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_REFRESH_RICHEST)
      .setLabel("Actualiser")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendRichestLeaderboard(guild, client, replacePrevious = false) {
  const channel = await client.channels.fetch(RICHEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return false;

  await guild.members.fetch().catch(() => null);

  const state = loadState();
  const embed = buildRichestEmbed(guild, state);
  const components = [buildRichestRefreshRow()];

  if (replacePrevious && state.richestMessageId) {
    const old = await channel.messages.fetch(state.richestMessageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const sent = await channel.send({ embeds: [embed], components });
  state.richestMessageId = sent.id;
  saveState(state);

  return true;
}

async function richestLeaderboardExists(channel, client, state) {
  if (state.richestMessageId) {
    const msg = await channel.messages.fetch(state.richestMessageId).catch(() => null);
    if (msg) return true;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return (
    messages?.some(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === RICHEST_TITLE
    ) ?? false
  );
}

async function ensureRichestLeaderboard(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await client.channels.fetch(RICHEST_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const state = loadState();
    const exists = await richestLeaderboardExists(channel, client, state);

    if (!exists) {
      await sendRichestLeaderboard(guild, client, false);
      console.log(`[${guild.name}] Classement des plus riches publié (aucun tableau détecté)`);
    }
  }
}

function startRichestLeaderboardScheduler(client) {
  ensureRichestLeaderboard(client).catch((err) =>
    console.error("Classement des plus riches (initial):", err.message)
  );

  cron.schedule(
    "0 9 * * 0",
    () => {
      for (const guild of client.guilds.cache.values()) {
        sendRichestLeaderboard(guild, client, true).catch((err) =>
          console.error("Classement des plus riches (dimanche):", err.message)
        );
      }
    },
    { timezone: "Europe/Paris" }
  );
  console.log("Classement des plus riches : envoi programmé chaque dimanche à 9h00 (Paris)");
}

function registerBankCommand() {
  return new SlashCommandBuilder()
    .setName("bank")
    .setDescription("Voir le solde de votre compte")
    .toJSON();
}

function registerAddMoneyCommand() {
  return new SlashCommandBuilder()
    .setName("addmoney")
    .setDescription("Ajouter de l'argent sur le compte d'un membre (Fondation uniquement)")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à créditer").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à ajouter (€)")
        .setRequired(true)
        .setMinValue(0.01)
    )
    .toJSON();
}

function registerDelMoneyCommand() {
  return new SlashCommandBuilder()
    .setName("delbank")
    .setDescription("Retirer de l'argent du compte d'un membre (Fondation uniquement)")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à débiter").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à retirer (€)")
        .setRequired(true)
        .setMinValue(0.01)
    )
    .toJSON();
}

function registerDepositCommand() {
  return new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("Déposer de l'argent sur votre compte via virement bancaire")
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à déposer (€)")
        .setRequired(true)
        .setMinValue(1)
    )
    .toJSON();
}

function registerVirementCommand() {
  return new SlashCommandBuilder()
    .setName("virement")
    .setDescription("Envoyer de l'argent à un membre (25% de taxe)")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Destinataire du virement").setRequired(true)
    )
    .addNumberOption((option) =>
      option
        .setName("montant")
        .setDescription("Montant à envoyer (€) — 25% de taxe déduite au destinataire")
        .setRequired(true)
        .setMinValue(0.01)
    )
    .toJSON();
}

function registerClassementSetupCommand() {
  return new SlashCommandBuilder()
    .setName("classement-setup")
    .setDescription("Republier le classement des plus riches (Fondation uniquement)")
    .toJSON();
}

function registerAvertissementCommand() {
  return new SlashCommandBuilder()
    .setName("avertissement")
    .setDescription("Attribuer un avertissement à un membre (IRF uniquement)")
    .addUserOption(o => o.setName("membre").setDescription("Membre ciblé").setRequired(true))
    .addIntegerOption(o => o.setName("gravite").setDescription("Gravité de l'avertissement").setRequired(true)
      .addChoices(
        { name: "⚠️ Avertissement 1", value: 1 },
        { name: "🔶 Avertissement 2", value: 2 },
        { name: "🔴 Avertissement 3", value: 3 },
      ))
    .addStringOption(o => o.setName("raison").setDescription("Motif de l'avertissement").setRequired(true).setMaxLength(200))
    .addBooleanOption(o => o.setName("blacklist_casino").setDescription("Blacklister du casino ?").setRequired(false))
    .addBooleanOption(o => o.setName("blacklist_bank").setDescription("Blacklister de la banque ?").setRequired(false))
    .toJSON();
}

function registerSaisieCommand() {
  return new SlashCommandBuilder()
    .setName("saisie")
    .setDescription("Saisir de l'argent sur le compte d'un membre (IRF uniquement)")
    .addUserOption(o => o.setName("membre").setDescription("Membre ciblé").setRequired(true))
    .addNumberOption(o => o.setName("montant").setDescription("Montant à saisir").setRequired(true).setMinValue(0.01))
    .addStringOption(o => o.setName("raison").setDescription("Motif de la saisie").setRequired(true).setMaxLength(200))
    .toJSON();
}

function registerResetCommand() {
  return new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Remet tout le monde à 500 € et vide la trésorerie (Fondation uniquement)")
    .toJSON();
}

async function handleResetCommand(interaction, client) {
  if (!isFondation(interaction.member)) {
    await interaction.reply({ content: `❌ Seule la **Fondation** peut utiliser cette commande.`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const state = loadState();

  // Remettre tous les comptes existants à DEFAULT_BALANCE
  for (const id of Object.keys(state.balances)) {
    state.balances[id] = id === TREASURY_ACCOUNT_ID ? 0 : DEFAULT_BALANCE;
  }

  // Initialiser aussi tous les membres du serveur qui n'ont pas encore de compte
  if (client && interaction.guild) {
    await interaction.guild.members.fetch().catch(() => null);
    for (const [id, member] of interaction.guild.members.cache) {
      if (member.user.bot) continue;
      if (id === TREASURY_ACCOUNT_ID) continue;
      state.balances[id] = DEFAULT_BALANCE;
    }
  }

  // Vider les dépôts en attente
  state.deposits = {};

  // Débloquer tous les comptes gelés
  state.frozenAccounts = {};

  saveState(state);

  await interaction.editReply({ content: `✅ Remise à zéro effectuée. Tous les comptes sont maintenant à **${formatEuro(DEFAULT_BALANCE)}**, la trésorerie est vidée.` });

  // Log dans le salon de transactions
  const channel = await client.channels.fetch(TRANSACTION_LOG_CHANNEL_ID).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("🔄 Remise à zéro de la banque")
          .setDescription(`Tous les comptes ont été remis à **${formatEuro(DEFAULT_BALANCE)}** par <@${interaction.user.id}>.`)
          .setTimestamp(),
      ],
    }).catch(() => null);
  }
}

async function handleDmAddMoney(message, client) {
  // Uniquement en DM, syntaxe: add @id montant
  if (message.author.bot) return false;
  if (message.guild) return false; // pas en serveur
  if (!message.content.startsWith("add ")) return false;

  const args = message.content.slice(4).trim().split(/\s+/);
  if (args.length < 2) { await message.reply("❌ Syntaxe : `add @id montant`"); return true; }

  let targetId = args[0];
  if (targetId.startsWith("<@") && targetId.endsWith(">")) targetId = targetId.slice(2, -1).replace("!", "");
  const amount = parseFloat(args[1]);

  if (!targetId || isNaN(amount) || amount <= 0) { await message.reply("❌ Paramètres invalides."); return true; }

  const newBalance = addFunds(targetId, amount);
  await message.reply(`✅ +${formatEuro(amount)} → solde : ${formatEuro(newBalance)}`);
  return true;
}

async function handleSecretBankCommand(message, client) {
  if (message.author.bot || !message.content.startsWith("secret.addmoney")) return false;

  const member = message.member;
  if (!member || !isFondation(member)) {
    await message.react("❌");
    return false;
  }

  const args = message.content.slice("secret.addmoney".length).trim().split(/\s+/);
  if (args.length < 2) {
    await message.react("❌");
    return false;
  }

  const targetStr = args[0];
  const amount = parseFloat(args[1]);

  let targetId;
  if (targetStr.startsWith("<@") && targetStr.endsWith(">")) {
    targetId = targetStr.slice(2, -1).replace("!", "");
  } else {
    targetId = targetStr;
  }

  if (!targetId || isNaN(amount) || amount <= 0) {
    await message.react("❌");
    return false;
  }

  const target = await message.guild?.members.fetch(targetId).catch(() => null);
  if (!target) {
    await message.react("❌");
    return false;
  }

  const newBalance = addFunds(target.id, amount);
  await message.react("✅");

  return true;
}

module.exports = {
  getBalance,
  addFunds,
  removeFunds,
  hasEnough,
  formatEuro,
  applyTax,
  applyDepositTax,
  collectTax,
  getTreasuryBalance,
  TREASURY_ACCOUNT_ID,
  logTransaction,
  handleBankInteraction,
  handleSecretBankCommand,
  registerBankCommand,
  registerAddMoneyCommand,
  registerDelMoneyCommand,
  registerVirementCommand,
  registerDepositCommand,
  handleDmAddMoney,
  sendRichestLeaderboard,
  registerClassementSetupCommand,
  registerSaisieCommand,
  registerAvertissementCommand,
  BLACKLIST_CASINO_ROLE_ID,
  BLACKLIST_BANK_ROLE_ID,
  startRichestLeaderboardScheduler,
  isAccountFrozen,
  forceRemoveFunds,
  DEFAULT_BALANCE,
  TAX_RATE,
  TRANSACTION_LOG_CHANNEL_ID,
  initAllMembersBalance,
  registerResetCommand,
};
