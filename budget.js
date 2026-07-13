const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const BUDGET_CHANNEL_ID = "1510000322024833194";
const BUDGET_LOG_CHANNEL_ID = "1510681001951498431";
const BUDGET_HISTORY_CHANNEL_ID = "1510687492896981102";
const RESPONSABLE_ROLE_ID = "1509984877120847963";
const GERANTS_ROLE_ID = "1509985135565475850";

const STATE_FILE = path.join(__dirname, "budget-state.json");
const DEFAULT_BUDGET = 3700;
const ACHAT_TIMEOUT_MS = 10 * 60 * 1000;

const BTN = {
  ADD: "budget_add_expense",
  MODIFY: "budget_modify_budget",
  REPORT: "budget_send_report",
  TABLE: "budget_expense_table",
  RESET: "budget_reset_week",
};
const MODAL = {
  EXPENSE: "budget_expense_modal",
  MODIFY: "budget_modify_modal",
};

const achatSessions = new Map();

function clearAchatSession(userId) {
  const session = achatSessions.get(userId);
  if (session?.timeout) clearTimeout(session.timeout);
  achatSessions.delete(userId);
}

function scheduleAchatTimeout(userId, user) {
  const session = achatSessions.get(userId);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  session.timeout = setTimeout(async () => {
    if (!achatSessions.has(userId)) return;
    clearAchatSession(userId);
    await user.send("⏱️ Temps écoulé. Demande annulée — relancez `/achat`.").catch(() => null);
  }, ACHAT_TIMEOUT_MS);
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    ensureWeek(data);
    if (!Array.isArray(data.expenses)) data.expenses = [];
    if (typeof data.totalBudget !== "number") data.totalBudget = DEFAULT_BUDGET;
    return data;
  } catch {
    const state = {
      messageId: null,
      weekStart: getWeekStartISO(),
      totalBudget: DEFAULT_BUDGET,
      expenses: [],
    };
    saveState(state);
    return state;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getParisDate() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" })
  );
}

function getWeekStartISO(date = getParisDate()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getWeekEndISO(weekStart) {
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function formatDateFr(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

function parseAmount(str) {
  return parseFloat(str.replace(",", ".").replace(/[^\d.]/g, ""));
}

function ensureWeek(state) {
  const current = getWeekStartISO();
  if (state.weekStart !== current) {
    state.weekStart = current;
    state.expenses = [];
  }
}

function isResponsable(member) {
  return member?.roles.cache.has(RESPONSABLE_ROLE_ID) ?? false;
}

function isGerant(member) {
  return member?.roles.cache.has(GERANTS_ROLE_ID) ?? false;
}

function getApprovedExpenses(state) {
  return state.expenses.filter((e) => e.status === "approved");
}

function getPendingExpenses(state) {
  return state.expenses.filter((e) => e.status === "pending");
}

function getTotalSpent(state) {
  return getApprovedExpenses(state).reduce((s, e) => s + e.amount, 0);
}

function getRemainingBudget(state) {
  return state.totalBudget - getTotalSpent(state);
}

function buildPanelEmbed(state) {
  ensureWeek(state);
  const spent = getTotalSpent(state);
  const remaining = getRemainingBudget(state);
  const weekEnd = getWeekEndISO(state.weekStart);
  const now = getParisDate();

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📊 Suivi du budget hebdomadaire")
    .setDescription(
      `**Période :** du ${formatDateFr(state.weekStart)} au ${formatDateFr(weekEnd)}`
    )
    .addFields(
      { name: "Budget total", value: formatEuro(state.totalBudget), inline: true },
      { name: "Dépenses cumulées", value: formatEuro(spent), inline: true },
      {
        name: "Budget restant",
        value: formatEuro(remaining),
        inline: true,
      }
    )
    .setFooter({
      text: `Mise à jour automatique • Gérants : panel • Tous : /achat`,
    });
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.ADD)
        .setLabel("Ajout dépense")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.MODIFY)
        .setLabel("Modifier budget")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(BTN.REPORT)
        .setLabel("Envoyer bilan")
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.TABLE)
        .setLabel("Tableau dépenses")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN.RESET)
        .setLabel("Reset semaine")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildExpenseModal() {
  return new ModalBuilder()
    .setCustomId(MODAL.EXPENSE)
    .setTitle("Ajout d'une dépense")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("montant")
          .setLabel("Montant (€)")
          .setPlaceholder("Ex: 175.00")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("libelle")
          .setLabel("Libellé / description")
          .setPlaceholder("Ex: Courses, fournitures…")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function buildModifyBudgetModal(currentBudget) {
  return new ModalBuilder()
    .setCustomId(MODAL.MODIFY)
    .setTitle("Modifier le budget hebdomadaire")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("budget")
          .setLabel("Nouveau budget total (€)")
          .setPlaceholder(String(currentBudget))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function buildHistoryLogEmbed(expense, validator, approved, state) {
  const isAchat = expense.type === "achat";
  const embed = new EmbedBuilder()
    .setColor(approved ? 0x2ecc71 : 0xe74c3c)
    .setTitle(
      approved
        ? isAchat
          ? "✅ Achat accepté"
          : "✅ Dépense acceptée"
        : isAchat
          ? "❌ Achat refusé"
          : "❌ Dépense refusée"
    )
    .addFields(
      {
        name: "Demandeur",
        value: `<@${expense.authorId}> (\`${expense.authorTag}\`)`,
        inline: true,
      },
      {
        name: approved ? "Accepté par" : "Refusé par",
        value: `${validator} (\`${validator.user.tag}\`)`,
        inline: true,
      },
      { name: "Montant", value: formatEuro(expense.amount), inline: true },
      {
        name: isAchat ? "Article" : "Libellé",
        value: expense.label,
        inline: false,
      },
      {
        name: "Date de la demande",
        value: formatDateTime(expense.createdAt),
        inline: true,
      },
      {
        name: approved ? "Date d'acceptation" : "Date de refus",
        value: formatDateTime(expense.validatedAt),
        inline: true,
      },
      {
        name: "Type",
        value: isAchat ? "🛒 Achat (/achat)" : "💶 Dépense (panel)",
        inline: true,
      }
    )
    .setTimestamp(new Date(expense.validatedAt));

  if (isAchat && expense.reason) {
    embed.addFields({ name: "Motif", value: expense.reason });
  }

  if (approved) {
    embed.addFields({
      name: "Budget restant",
      value: formatEuro(getRemainingBudget(state)),
      inline: true,
    });
  }

  return embed;
}

async function sendHistoryLog(guild, expense, validator, approved, state) {
  const channel = await guild.channels
    .fetch(BUDGET_HISTORY_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon historique budget ${BUDGET_HISTORY_CHANNEL_ID} introuvable`);
    return;
  }

  await channel.send({
    embeds: [buildHistoryLogEmbed(expense, validator, approved, state)],
  });
}

function buildValidationRow(expenseId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`budget_approve_${expenseId}`)
      .setLabel("Valider")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`budget_reject_${expenseId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildPendingEmbed(expense, author) {
  const isAchat = expense.type === "achat";
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(
      isAchat
        ? "⏳ Demande d'achat en attente"
        : "⏳ Dépense en attente de validation"
    )
    .addFields(
      { name: "Montant", value: formatEuro(expense.amount), inline: true },
      { name: "Demandeur", value: `${author}`, inline: true },
      {
        name: isAchat ? "Article" : "Libellé",
        value: expense.label,
      }
    );

  if (isAchat && expense.reason) {
    embed.addFields({ name: "Pourquoi", value: expense.reason });
  }

  embed.addFields({
    name: "Statut",
    value:
      "En attente — un **Responsable** doit valider ou refuser.\n" +
      `Budget restant actuel : **${formatEuro(getRemainingBudget(loadState()))}**`,
  });

  return embed.setTimestamp(new Date(expense.createdAt));
}

function buildApprovedEmbed(expense, validator, state) {
  const isAchat = expense.type === "achat";
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(isAchat ? "✅ Achat validé" : "✅ Dépense validée")
    .addFields(
      { name: "Montant", value: formatEuro(expense.amount), inline: true },
      { name: "Demandeur", value: `<@${expense.authorId}>`, inline: true },
      { name: "Validé par", value: `${validator}`, inline: true },
      {
        name: isAchat ? "Article" : "Libellé",
        value: expense.label,
      },
      {
        name: "Budget restant",
        value: formatEuro(getRemainingBudget(state)),
        inline: true,
      }
    );

  if (isAchat && expense.reason) {
    embed.addFields({ name: "Pourquoi", value: expense.reason });
  }

  return embed.setTimestamp(new Date(expense.validatedAt));
}

function buildRejectedEmbed(expense, validator) {
  const isAchat = expense.type === "achat";
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(isAchat ? "❌ Achat refusé" : "❌ Dépense refusée")
    .addFields(
      { name: "Montant", value: formatEuro(expense.amount), inline: true },
      { name: "Demandeur", value: `<@${expense.authorId}>`, inline: true },
      { name: "Refusé par", value: `${validator}`, inline: true },
      {
        name: isAchat ? "Article" : "Libellé",
        value: expense.label,
      }
    );

  if (isAchat && expense.reason) {
    embed.addFields({ name: "Pourquoi", value: expense.reason });
  }

  return embed.setTimestamp(new Date(expense.validatedAt));
}

function buildExpenseTableEmbed(state) {
  const approved = getApprovedExpenses(state);
  const pending = getPendingExpenses(state);

  let table = approved.length
    ? approved
        .map((e, i) => {
          const tag = e.type === "achat" ? "🛒" : "💶";
          return (
            `**${i + 1}.** ${tag} ${formatEuro(e.amount)} — ${e.label}\n` +
            `   *<@${e.authorId}>*`
          );
        })
        .join("\n")
    : "*Aucune dépense validée cette semaine.*";

  if (pending.length) {
    table +=
      "\n\n⏳ **En attente :**\n" +
      pending
        .map((e) => {
          const tag = e.type === "achat" ? "🛒" : "💶";
          return `• ${tag} ${formatEuro(e.amount)} — ${e.label}`;
        })
        .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📋 Tableau des dépenses")
    .setDescription(
      `**Semaine du ${formatDateFr(state.weekStart)} au ${formatDateFr(getWeekEndISO(state.weekStart))}**\n\n${table}`
    )
    .setFooter({
      text: `Validé : ${formatEuro(getTotalSpent(state))} • Restant : ${formatEuro(getRemainingBudget(state))}`,
    });
}

function buildReportEmbed(state, guild) {
  const spent = getTotalSpent(state);
  const remaining = getRemainingBudget(state);
  const approved = getApprovedExpenses(state);

  const details = approved.length
    ? approved
        .map((e) => {
          const tag = e.type === "achat" ? "🛒" : "💶";
          return `• ${tag} ${formatEuro(e.amount)} — ${e.label}`;
        })
        .join("\n")
    : "*Aucune dépense validée.*";

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📊 Bilan hebdomadaire")
    .setDescription(
      `**${guild.name}**\n` +
        `Période : ${formatDateFr(state.weekStart)} → ${formatDateFr(getWeekEndISO(state.weekStart))}`
    )
    .addFields(
      { name: "Budget total", value: formatEuro(state.totalBudget), inline: true },
      { name: "Dépenses", value: formatEuro(spent), inline: true },
      { name: "Restant", value: formatEuro(remaining), inline: true },
      { name: "Détail", value: details.slice(0, 1024) }
    )
    .setTimestamp();
}

async function updateBudgetPanel(client) {
  const channel = await client.channels.fetch(BUDGET_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  ensureWeek(state);
  const embed = buildPanelEmbed(state);
  const components = buildPanelComponents();

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    msg = messages?.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title === "📊 Suivi du budget hebdomadaire"
    );
  }

  if (msg) {
    await msg.edit({ embeds: [embed], components });
    state.messageId = msg.id;
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    state.messageId = sent.id;
  }

  saveState(state);
}

async function setupBudgetPanel(client) {
  await updateBudgetPanel(client);
  console.log("Panneau budget publié");
}

async function registerBudgetCommands(client, token) {
  const commands = [
    new SlashCommandBuilder()
      .setName("achat")
      .setDescription("Demande d'achat d'un produit")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(token);
  for (const guild of client.guilds.cache.values()) {
    await rest
      .put(Routes.applicationGuildCommands(client.user.id, guild.id), {
        body: commands,
      })
      .catch((err) =>
        console.warn(`Commande /achat (${guild.name}):`, err.message)
      );
  }
  console.log("Commande /achat enregistrée");
}

async function handleAchatDmMessage(message, client) {
  if (message.author.bot) return false;
  if (message.guild) return false;

  const session = achatSessions.get(message.author.id);
  if (!session) return false;

  const content = message.content?.trim();
  if (!content) {
    await message.reply("❌ Réponse vide. Merci de répondre à la question.").catch(() => null);
    return true;
  }

  scheduleAchatTimeout(message.author.id, message.author);

  const guild = await client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) {
    clearAchatSession(message.author.id);
    await message.reply("❌ Serveur introuvable. Relancez `/achat`.").catch(() => null);
    return true;
  }

  if (session.step === 1) {
    session.article = content;
    session.step = 2;
    await message.reply(
      "🛒 **Question 2/3**\n\n**Quel est le prix (en €) ?**\n*Exemple : 150 ou 150.50*"
    );
    return true;
  }

  if (session.step === 2) {
    const amount = parseAmount(content);
    if (!amount || amount <= 0 || Number.isNaN(amount)) {
      await message.reply("❌ Prix invalide. Entrez un nombre (ex: `150` ou `150.50`).");
      return true;
    }
    session.amount = amount;
    session.step = 3;
    await message.reply(
      "🛒 **Question 3/3**\n\n**Pourquoi avez-vous besoin de cet achat ?**"
    );
    return true;
  }

  if (session.step === 3) {
    session.reason = content;
    clearAchatSession(message.author.id);

    try {
      await submitPurchaseRequest(
        guild,
        message.author,
        session.article,
        session.amount,
        session.reason
      );

      await message.reply(
        `✅ **Demande envoyée !**\n\n` +
          `**Article :** ${session.article}\n` +
          `**Prix :** ${formatEuro(session.amount)}\n` +
          `**Motif :** ${session.reason}\n\n` +
          `En attente de validation par un **Responsable** dans <#${BUDGET_LOG_CHANNEL_ID}>.\n` +
          `Si validée, le montant sera **déduit automatiquement** du budget.`
      );
    } catch (err) {
      console.error("Erreur soumission achat:", err.message);
      await message.reply("❌ Erreur lors de l'envoi. Réessayez avec `/achat`.").catch(() => null);
    }
    return true;
  }

  return false;
}

async function submitPurchaseRequest(guild, user, article, amount, reason) {
  const state = loadState();
  ensureWeek(state);

  const expense = {
    id: `achat_${Date.now()}_${user.id.slice(-4)}`,
    type: "achat",
    amount,
    label: article,
    reason,
    authorId: user.id,
    authorTag: user.tag,
    status: "pending",
    createdAt: Date.now(),
    logMessageId: null,
  };

  state.expenses.push(expense);
  saveState(state);

  const logChannel = await guild.channels.fetch(BUDGET_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased()) {
    throw new Error("Salon de validation introuvable");
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  const pendingEmbed = buildPendingEmbed(expense, member ?? user);

  const logMsg = await logChannel.send({
    content: `<@&${RESPONSABLE_ROLE_ID}> — Nouvelle **demande d'achat** à valider`,
    embeds: [pendingEmbed],
    components: [buildValidationRow(expense.id)],
  });

  expense.logMessageId = logMsg.id;
  saveState(state);

  return expense;
}

async function startAchatCommand(interaction) {
  if (achatSessions.has(interaction.user.id)) {
    await interaction.reply({
      content: "⏳ Vous avez déjà une demande d'achat en cours. Répondez en MP ou attendez 10 min.",
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.user.send(
      "🛒 **Demande d'achat — Question 1/3**\n\n**Que souhaitez-vous acheter ?**\n\n" +
        "*Répondez ici en message privé, une question à la fois.*"
    );
  } catch {
    await interaction.reply({
      content:
        "❌ Impossible de vous envoyer un MP.\n" +
        "Paramètres Discord → Confidentialité → **Autoriser les messages privés des membres du serveur**.",
      ephemeral: true,
    });
    return;
  }

  achatSessions.set(interaction.user.id, {
    step: 1,
    guildId: interaction.guild.id,
    article: null,
    amount: null,
    reason: null,
    timeout: null,
  });
  scheduleAchatTimeout(interaction.user.id, interaction.user);

  await interaction.reply({
    content:
      "🛒 **3 questions envoyées en message privé.**\n" +
      "Ouvrez vos **MP avec le bot House** et répondez-y une par une.",
    ephemeral: true,
  });
}

async function submitPanelExpense(interaction, amount, label) {
  const state = loadState();
  ensureWeek(state);

  const expense = {
    id: `dep_${Date.now()}_${interaction.user.id.slice(-4)}`,
    type: "depense",
    amount,
    label,
    authorId: interaction.user.id,
    authorTag: interaction.user.tag,
    status: "pending",
    createdAt: Date.now(),
    logMessageId: null,
  };

  state.expenses.push(expense);
  saveState(state);

  const logChannel = await interaction.guild.channels
    .fetch(BUDGET_LOG_CHANNEL_ID)
    .catch(() => null);

  if (!logChannel?.isTextBased()) {
    await interaction.reply({
      content: "❌ Salon de validation introuvable.",
      ephemeral: true,
    });
    return;
  }

  const pendingEmbed = buildPendingEmbed(expense, interaction.member);
  const logMsg = await logChannel.send({
    content: `<@&${RESPONSABLE_ROLE_ID}> — Nouvelle dépense à valider`,
    embeds: [pendingEmbed],
    components: [buildValidationRow(expense.id)],
  });

  expense.logMessageId = logMsg.id;
  saveState(state);

  await interaction.reply({
    content:
      `⏳ Dépense de **${formatEuro(amount)}** soumise.\n` +
      `Validation Responsable requise dans <#${BUDGET_LOG_CHANNEL_ID}>.`,
    ephemeral: true,
  });
}

async function validateExpense(interaction, expenseId, approved) {
  if (!isResponsable(interaction.member)) {
    await interaction.reply({
      content: "❌ Seuls les **Responsables** peuvent valider.",
      ephemeral: true,
    });
    return;
  }

  const state = loadState();
  ensureWeek(state);
  const expense = state.expenses.find((e) => e.id === expenseId);

  if (!expense || expense.status !== "pending") {
    await interaction.reply({
      content: "❌ Cette demande n'est plus en attente.",
      ephemeral: true,
    });
    return;
  }

  if (approved) {
    const remaining = getRemainingBudget(state);
    if (expense.amount > remaining) {
      await interaction.reply({
        content:
          `❌ **Budget insuffisant.**\n` +
          `Montant : ${formatEuro(expense.amount)}\n` +
          `Restant : ${formatEuro(remaining)}`,
        ephemeral: true,
      });
      return;
    }
  }

  expense.status = approved ? "approved" : "rejected";
  expense.validatedAt = Date.now();
  expense.validatorId = interaction.user.id;
  saveState(state);

  const embed = approved
    ? buildApprovedEmbed(expense, interaction.member, state)
    : buildRejectedEmbed(expense, interaction.member);

  await interaction.update({ embeds: [embed], components: [] });

  await sendHistoryLog(
    interaction.guild,
    expense,
    interaction.member,
    approved,
    state
  );

  if (approved) {
    await updateBudgetPanel(interaction.client);
    try {
      const author = await interaction.guild.members.fetch(expense.authorId);
      const label =
        expense.type === "achat"
          ? `achat « ${expense.label} »`
          : `dépense « ${expense.label} »`;
      await author
        .send(
          `✅ Votre ${label} (**${formatEuro(expense.amount)}**) a été **validée**.`
        )
        .catch(() => null);
    } catch {
      /* ignore */
    }
  } else {
    try {
      const author = await interaction.guild.members.fetch(expense.authorId);
      await author
        .send(
          `❌ Votre demande **${formatEuro(expense.amount)}** (${expense.label}) a été **refusée**.`
        )
        .catch(() => null);
    } catch {
      /* ignore */
    }
  }

  await interaction.followUp({
    content: approved
      ? `✅ Validé — ${formatEuro(expense.amount)} déduit. Restant : ${formatEuro(getRemainingBudget(loadState()))}`
      : "❌ Demande refusée.",
    ephemeral: true,
  });
}

function denyGerant(interaction) {
  return interaction.reply({
    content: "❌ Seuls les **Gérants** peuvent utiliser le panel budget.",
    ephemeral: true,
  });
}

function startBudgetScheduler(client) {
  cron.schedule(
    "0 0 * * *",
    () => {
      const state = loadState();
      const before = state.weekStart;
      ensureWeek(state);
      if (state.weekStart !== before) {
        state.expenses = [];
        saveState(state);
      }
      updateBudgetPanel(client).catch(() => null);
    },
    { timezone: "Europe/Paris" }
  );
}

async function handleBudgetInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "achat") {
    await startAchatCommand(interaction);
    return true;
  }

  if (interaction.isButton()) {
    if (
      [BTN.ADD, BTN.MODIFY, BTN.REPORT, BTN.TABLE, BTN.RESET].includes(
        interaction.customId
      )
    ) {
      if (!isGerant(interaction.member)) {
        await denyGerant(interaction);
        return true;
      }
    }

    if (interaction.customId === BTN.ADD) {
      await interaction.showModal(buildExpenseModal());
      return true;
    }

    if (interaction.customId === BTN.MODIFY) {
      const state = loadState();
      await interaction.showModal(buildModifyBudgetModal(state.totalBudget));
      return true;
    }

    if (interaction.customId === BTN.REPORT) {
      const state = loadState();
      const embed = buildReportEmbed(state, interaction.guild);
      await interaction.channel.send({ embeds: [embed] });
      await interaction.reply({
        content: "📊 Bilan envoyé dans ce salon.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.TABLE) {
      const state = loadState();
      await interaction.reply({
        embeds: [buildExpenseTableEmbed(state)],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.RESET) {
      const state = loadState();
      state.expenses = [];
      state.weekStart = getWeekStartISO();
      saveState(state);
      await updateBudgetPanel(interaction.client);
      await interaction.reply({
        content: "🔄 Semaine réinitialisée.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith("budget_approve_")) {
      const id = interaction.customId.slice("budget_approve_".length);
      await validateExpense(interaction, id, true);
      return true;
    }

    if (interaction.customId.startsWith("budget_reject_")) {
      const id = interaction.customId.slice("budget_reject_".length);
      await validateExpense(interaction, id, false);
      return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === MODAL.EXPENSE) {
      if (!isGerant(interaction.member)) {
        await denyGerant(interaction);
        return true;
      }

      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      const label = interaction.fields.getTextInputValue("libelle").trim();

      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({
          content: "❌ Montant invalide.",
          ephemeral: true,
        });
        return true;
      }
      if (!label) {
        await interaction.reply({
          content: "❌ Libellé requis.",
          ephemeral: true,
        });
        return true;
      }

      await submitPanelExpense(interaction, amount, label);
      return true;
    }

    if (interaction.customId === MODAL.MODIFY) {
      if (!isGerant(interaction.member)) {
        await denyGerant(interaction);
        return true;
      }

      const budget = parseAmount(interaction.fields.getTextInputValue("budget"));

      if (!budget || budget <= 0 || Number.isNaN(budget)) {
        await interaction.reply({
          content: "❌ Budget invalide.",
          ephemeral: true,
        });
        return true;
      }

      const state = loadState();
      state.totalBudget = budget;
      saveState(state);
      await updateBudgetPanel(interaction.client);

      await interaction.reply({
        content: `✅ Budget mis à jour : **${formatEuro(budget)}**`,
        ephemeral: true,
      });
      return true;
    }
  }

  return false;
}

module.exports = {
  setupBudgetPanel,
  startBudgetScheduler,
  handleBudgetInteraction,
  handleAchatDmMessage,
  updateBudgetPanel,
  registerBudgetCommands,
};
