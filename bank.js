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
const DEFAULT_BALANCE = 500;
/** Compte "Banque de la Maison" : reçoit toutes les taxes (démarre à 0, pas à 500). */
const TREASURY_ACCOUNT_ID = "1509969106999443678";
const TAX_RATE = 0.25;
const DEPOSIT_TAX_RATE = 0.05; // taxe sur les dépôts validés par la Fondation
const TRANSACTION_LOG_CHANNEL_ID = "1510687492896981102";
const FONDATION_ROLE_ID = "1509974377267990659";
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
function collectTax(taxAmount) {
  if (!taxAmount || taxAmount <= 0) return;
  return addFunds(TREASURY_ACCOUNT_ID, taxAmount);
}

function getTreasuryBalance() {
  const state = loadState();
  return typeof state.balances[TREASURY_ACCOUNT_ID] === "number"
    ? state.balances[TREASURY_ACCOUNT_ID]
    : 0;
}

function getBalance(userId) {
  const state = loadState();
  const balance = ensureAccount(state, userId);
  saveState(state);
  return balance;
}

/** amount peut être négatif pour retirer. Renvoie le nouveau solde. */
function addFunds(userId, amount) {
  const state = loadState();
  // Bloquer toute transaction sur un compte gelé (sauf les amendes IRF qui passent par removeFunds directement)
  if (state.frozenAccounts && state.frozenAccounts[userId] && amount < 0) {
    // Les retraits sont bloqués sur compte gelé
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

function hasEnough(userId, amount) {
  return getBalance(userId) >= amount;
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
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/delbank\`.`,
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

  if (interaction.isChatInputCommand() && interaction.commandName === "virement") {
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
    collectTax(tax);

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
        { name: "Vous recevrez", value: `**${formatEuro(net)}**`, inline: true },
        { name: "Taxe (5%)", value: formatEuro(tax), inline: true },
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

    const { gross, tax, net } = applyDepositTax(request.amount);
    addFunds(request.userId, net);
    collectTax(tax);

    request.status = "accepted";
    request.validatedAt = Date.now();
    request.validatorId = interaction.user.id;
    saveState(state);

    await logTransaction(client, {
      type: "🏦 Dépôt validé (/deposit)",
      to: request.userId,
      gross,
      tax,
      net,
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Dépôt validé")
      .addFields(
        { name: "Membre", value: `<@${request.userId}>`, inline: true },
        { name: "Validé par", value: `${interaction.user}`, inline: true },
        { name: "Montant", value: formatEuro(gross), inline: true },
        { name: `Taxe (5%)`, value: formatEuro(tax), inline: true },
        { name: "Crédité", value: `**${formatEuro(net)}**`, inline: true },
      )
      .setTimestamp();

    await interaction.update({ content: "", embeds: [embed], components: [] });

    const user = await client.users.fetch(request.userId).catch(() => null);
    if (user) {
      await user
        .send(`✅ Votre dépôt de **${formatEuro(gross)}** a été validé — **${formatEuro(net)}** crédités sur votre compte \`/bank\`.`)
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
        { name: "Motif", value: request.motif || "—" }
      )
      .setTimestamp();

    await interaction.update({ content: "", embeds: [embed], components: [] });

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
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut forcer l'actualisation.`,
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
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut republier le classement.`,
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
  registerClassementSetupCommand,
  startRichestLeaderboardScheduler,
  DEFAULT_BALANCE,
  TAX_RATE,
  TRANSACTION_LOG_CHANNEL_ID,
};
