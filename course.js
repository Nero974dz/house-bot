const fs = require("fs");
const cron = require("node-cron");
const { getStatePath, persistState } = require("./storage");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const COURSE_CHANNEL_ID = "1531820640246562986";
const COURSE_LOG_CHANNEL_ID = "1510681001951498431";
const COURSE_GERANT_ROLE_ID = "1531823144346845224";

const STATE_FILE = getStatePath("course-state.json");
const WEEKLY_BUDGET = 1200;
const PER_PERSON_CAP = 250;

const BTN = {
  ADD: "course_add",
  REMOVE: "course_remove",
  VIEW: "course_view",
  SUBMIT: "course_submit",
  CLEAR: "course_clear",
};
const MODAL_ADD = "course_modal_add";
const SELECT_REMOVE = "course_select_remove";

// --- Table de prix moyens (supermarché français, estimation générale) ---
// Clé = mot-clé recherché dans le nom de l'article (insensible à la casse/accents).
const PRICE_TABLE = [
  // Produits laitiers / oeufs
  { kw: ["lait"], price: 1.1 },
  { kw: ["beurre"], price: 2.3 },
  { kw: ["oeuf", "oeufs"], price: 3.2 },
  { kw: ["fromage", "camembert", "emmental", "gruyere", "mozzarella", "chevre"], price: 4.5 },
  { kw: ["yaourt", "yaourts"], price: 2.8 },
  { kw: ["creme fraiche", "creme"], price: 1.6 },

  // Viandes / poissons
  { kw: ["poulet"], price: 7.5 },
  { kw: ["boeuf", "steak", "bavette", "entrecote"], price: 12 },
  { kw: ["porc", "cote de porc", "jambon"], price: 6.5 },
  { kw: ["saucisse", "saucisses", "merguez", "chipolata"], price: 5.5 },
  { kw: ["poisson", "saumon", "cabillaud", "thon", "colin"], price: 9.5 },
  { kw: ["dinde"], price: 8 },
  { kw: ["lardon", "lardons", "bacon"], price: 3.5 },

  // Fruits & légumes (au kilo / le filet)
  { kw: ["pomme", "pommes"], price: 2.5 },
  { kw: ["banane", "bananes"], price: 2.1 },
  { kw: ["orange", "oranges"], price: 2.8 },
  { kw: ["tomate", "tomates"], price: 2.9 },
  { kw: ["salade", "laitue"], price: 1.5 },
  { kw: ["pomme de terre", "pommes de terre", "patate"], price: 2.2 },
  { kw: ["carotte", "carottes"], price: 1.8 },
  { kw: ["oignon", "oignons"], price: 1.6 },
  { kw: ["courgette", "courgettes"], price: 2.3 },
  { kw: ["avocat", "avocats"], price: 1.5 },
  { kw: ["citron", "citrons"], price: 2.4 },
  { kw: ["fraise", "fraises"], price: 3.5 },

  // Épicerie / féculents
  { kw: ["pate", "pates", "spaghetti", "penne"], price: 1.3 },
  { kw: ["riz"], price: 2.4 },
  { kw: ["pain", "baguette"], price: 1.2 },
  { kw: ["farine"], price: 1.1 },
  { kw: ["sucre"], price: 1.3 },
  { kw: ["sel"], price: 0.8 },
  { kw: ["huile"], price: 3.5 },
  { kw: ["ketchup", "mayonnaise", "moutarde", "sauce"], price: 2.6 },
  { kw: ["cereales"], price: 3.8 },
  { kw: ["biscuit", "biscuits", "gateau", "gateaux"], price: 2.9 },
  { kw: ["chocolat"], price: 2.5 },
  { kw: ["confiture"], price: 2.7 },
  { kw: ["cafe"], price: 5.5 },
  { kw: ["the", "thé"], price: 3.2 },
  { kw: ["conserve", "boite de conserve", "haricot", "haricots", "petit pois", "mais", "maïs"], price: 1.7 },
  { kw: ["pizza"], price: 4.5 },
  { kw: ["surgele", "surgelé", "surgelés", "surgeles"], price: 5 },

  // Boissons
  { kw: ["eau", "eau minerale"], price: 0.6 },
  { kw: ["jus", "jus de fruit"], price: 2.5 },
  { kw: ["soda", "coca", "limonade"], price: 1.9 },
  { kw: ["vin"], price: 6 },
  { kw: ["biere", "bière"], price: 5.5 },

  // Hygiène / entretien (parfois inclus dans les courses)
  { kw: ["papier toilette", "pq"], price: 6 },
  { kw: ["lessive"], price: 7 },
  { kw: ["shampoing", "gel douche", "savon"], price: 3.5 },
  { kw: ["dentifrice"], price: 2.5 },
  { kw: ["essuie tout", "sopalin"], price: 3 },
];

// Estimation générique par défaut quand aucun mot-clé ne correspond.
const DEFAULT_PRICE = 3.5;

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Estime le prix d'un article à partir de la table de prix. Renvoie { price, matched }. */
function estimatePrice(name) {
  const n = normalize(name);
  for (const entry of PRICE_TABLE) {
    if (entry.kw.some((kw) => n.includes(normalize(kw)))) {
      return { price: entry.price, matched: true };
    }
  }
  return { price: DEFAULT_PRICE, matched: false };
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

function getParisDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
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

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.lists)) data.lists = [];
    if (!data.drafts || typeof data.drafts !== "object") data.drafts = {};
    if (typeof data.weekStart !== "string") data.weekStart = getWeekStartISO();
    if (typeof data.messageId !== "string") data.messageId = null;
    ensureWeek(data);
    return data;
  } catch {
    const state = { messageId: null, weekStart: getWeekStartISO(), lists: [], drafts: {} };
    saveState(state);
    return state;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("course-state.json");
}

function ensureWeek(state) {
  const current = getWeekStartISO();
  if (state.weekStart !== current) {
    state.weekStart = current;
    state.lists = [];
    state.drafts = {};
  }
}

function isGerantCourse(member) {
  return member?.roles.cache.has(COURSE_GERANT_ROLE_ID) ?? false;
}

function getApprovedLists(state) {
  return state.lists.filter((l) => l.status === "approved");
}

function getTotalSpent(state) {
  return getApprovedLists(state).reduce((s, l) => s + l.total, 0);
}

function getRemainingBudget(state) {
  return Math.max(0, WEEKLY_BUDGET - getTotalSpent(state));
}

/** Montant déjà engagé (validé ou en attente) par ce membre cette semaine, hors brouillon. */
function getUserCommittedThisWeek(state, userId) {
  return state.lists
    .filter((l) => l.authorId === userId && (l.status === "approved" || l.status === "pending"))
    .reduce((s, l) => s + l.total, 0);
}

function getDraft(state, userId) {
  return state.drafts[userId] || { items: [], total: 0 };
}

function setDraft(state, userId, draft) {
  state.drafts[userId] = draft;
}

function clearDraft(state, userId) {
  delete state.drafts[userId];
}

function itemsSummary(items) {
  if (!items.length) return "*Aucun article.*";
  return items
    .map((it, i) => `**${i + 1}.** ${it.name} — ${formatEuro(it.price)}${it.matched ? "" : " *(estimation)*"}`)
    .join("\n");
}

// ------------------------------------------------------------------
// Panel principal (posté/mis à jour dans le salon courses)
// ------------------------------------------------------------------

function buildPanelEmbed(state) {
  const spent = getTotalSpent(state);
  const remaining = getRemainingBudget(state);
  const weekEnd = getWeekEndISO(state.weekStart);

  return new EmbedBuilder()
    .setColor(0x27ae60)
    .setTitle("🛒 Courses de la semaine")
    .setDescription(
      `**Période :** du ${formatDateFr(state.weekStart)} au ${formatDateFr(weekEnd)}\n\n` +
        `Ajoutez vos aliments un par un avec **Ajouter un article** — le bot estime le prix automatiquement.\n` +
        `Plafond individuel : **${formatEuro(PER_PERSON_CAP)} / semaine**.\n` +
        `Une fois votre liste prête, cliquez sur **Envoyer ma liste** pour la soumettre à validation.`
    )
    .addFields(
      { name: "Budget total semaine", value: formatEuro(WEEKLY_BUDGET), inline: true },
      { name: "Déjà validé", value: formatEuro(spent), inline: true },
      { name: "Restant (global)", value: formatEuro(remaining), inline: true }
    )
    .setFooter({ text: "Vos ajouts sont privés (visibles de vous seul) jusqu'à l'envoi de la liste." });
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN.ADD).setLabel("Ajouter un article").setEmoji("➕").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN.REMOVE).setLabel("Supprimer un article").setEmoji("➖").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(BTN.VIEW).setLabel("Voir ma liste").setEmoji("📋").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN.SUBMIT).setLabel("Envoyer ma liste").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BTN.CLEAR).setLabel("Vider ma liste").setEmoji("🗑️").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function updateCoursePanel(client) {
  const channel = await client.channels.fetch(COURSE_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  const embed = buildPanelEmbed(state);
  const components = buildPanelComponents();

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    msg = messages?.find((m) => m.author.id === client.user.id && m.embeds[0]?.title === "🛒 Courses de la semaine");
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

async function setupCoursePanel(client) {
  await updateCoursePanel(client);
  console.log("Panneau courses publié");
}

// ------------------------------------------------------------------
// Ajout / suppression / consultation du brouillon (privé, par membre)
// ------------------------------------------------------------------

function buildAddModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ADD)
    .setTitle("🛒 Ajouter un article")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("aliment")
          .setLabel("Nom de l'aliment")
          .setPlaceholder("Ex: Poulet, Pâtes, Lait…")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
}

async function handleAddItem(interaction) {
  const name = interaction.fields.getTextInputValue("aliment").trim();
  if (!name) {
    await interaction.reply({ content: "❌ Nom d'aliment invalide.", ephemeral: true });
    return;
  }

  const state = loadState();
  const userId = interaction.user.id;
  const draft = getDraft(state, userId);
  const committed = getUserCommittedThisWeek(state, userId);
  const remainingForUser = Math.max(0, PER_PERSON_CAP - committed - draft.total);

  if (remainingForUser <= 0) {
    await interaction.reply({
      content: `❌ Vous avez atteint votre plafond de **${formatEuro(PER_PERSON_CAP)}** pour cette semaine.`,
      ephemeral: true,
    });
    return;
  }

  const { price, matched } = estimatePrice(name);

  if (price > remainingForUser) {
    await interaction.reply({
      content:
        `❌ **${name}** coûte environ ${formatEuro(price)}${matched ? "" : " (estimation)"}, ` +
        `ce qui dépasserait votre plafond de ${formatEuro(PER_PERSON_CAP)}.\n` +
        `Il vous reste **${formatEuro(remainingForUser)}**.`,
      ephemeral: true,
    });
    return;
  }

  draft.items.push({ name, price, matched });
  draft.total = Math.round((draft.total + price) * 100) / 100;
  setDraft(state, userId, draft);
  saveState(state);

  const newRemaining = Math.max(0, PER_PERSON_CAP - committed - draft.total);
  await interaction.reply({
    content:
      `✅ **${name}** ajouté — environ ${formatEuro(price)}${matched ? "" : " (estimation)"}.\n\n` +
      `${itemsSummary(draft.items)}\n\n` +
      `**Total de ma liste : ${formatEuro(draft.total)}** (reste ${formatEuro(newRemaining)} sur mon plafond)`,
    ephemeral: true,
  });
}

async function handleViewDraft(interaction) {
  const state = loadState();
  const draft = getDraft(state, interaction.user.id);
  const committed = getUserCommittedThisWeek(state, interaction.user.id);
  const remaining = Math.max(0, PER_PERSON_CAP - committed - draft.total);

  await interaction.reply({
    content:
      `📋 **Ma liste de courses**\n\n${itemsSummary(draft.items)}\n\n` +
      `**Total : ${formatEuro(draft.total)}** (reste ${formatEuro(remaining)} sur mon plafond de ${formatEuro(PER_PERSON_CAP)})`,
    ephemeral: true,
  });
}

async function handleClearDraft(interaction) {
  const state = loadState();
  const draft = getDraft(state, interaction.user.id);

  if (draft.items.length === 0) {
    await interaction.reply({ content: "ℹ️ Votre liste est déjà vide.", ephemeral: true });
    return;
  }

  clearDraft(state, interaction.user.id);
  saveState(state);
  await interaction.reply({ content: "🗑️ Votre liste a été vidée.", ephemeral: true });
}

async function handleRemovePrompt(interaction) {
  const state = loadState();
  const draft = getDraft(state, interaction.user.id);

  if (draft.items.length === 0) {
    await interaction.reply({ content: "ℹ️ Votre liste est vide, rien à supprimer.", ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_REMOVE)
    .setPlaceholder("Choisissez un article à supprimer")
    .addOptions(
      draft.items.slice(0, 25).map((it, i) => ({
        label: `${it.name} — ${formatEuro(it.price)}`.slice(0, 100),
        value: String(i),
      }))
    );

  await interaction.reply({
    content: "➖ Sélectionnez l'article à supprimer :",
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

async function handleRemoveSelect(interaction) {
  const index = parseInt(interaction.values[0], 10);
  const state = loadState();
  const userId = interaction.user.id;
  const draft = getDraft(state, userId);

  if (Number.isNaN(index) || index < 0 || index >= draft.items.length) {
    await interaction.update({ content: "❌ Article introuvable (liste déjà modifiée).", components: [] });
    return;
  }

  const [removed] = draft.items.splice(index, 1);
  draft.total = Math.round(draft.items.reduce((s, it) => s + it.price, 0) * 100) / 100;
  setDraft(state, userId, draft);
  saveState(state);

  await interaction.update({
    content:
      `✅ **${removed.name}** supprimé.\n\n${itemsSummary(draft.items)}\n\n` +
      `**Total de ma liste : ${formatEuro(draft.total)}**`,
    components: [],
  });
}

// ------------------------------------------------------------------
// Soumission de la liste et validation par un Gérant courses
// ------------------------------------------------------------------

function buildValidationRow(listId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`course_approve_${listId}`).setLabel("Valider").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`course_reject_${listId}`).setLabel("Refuser").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );
}

function buildPendingEmbed(list, author, state) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("⏳ Liste de courses en attente de validation")
    .addFields(
      { name: "Demandeur", value: `${author}`, inline: true },
      { name: "Total estimé", value: formatEuro(list.total), inline: true },
      { name: "Articles", value: itemsSummary(list.items).slice(0, 1024) },
      {
        name: "Statut",
        value:
          "En attente — un **Gérant courses** doit valider ou refuser.\n" +
          `Budget hebdomadaire restant actuel : **${formatEuro(getRemainingBudget(state))}**`,
      }
    )
    .setTimestamp(new Date(list.createdAt));
}

function buildApprovedEmbed(list, validator, state) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Liste de courses validée")
    .addFields(
      { name: "Demandeur", value: `<@${list.authorId}>`, inline: true },
      { name: "Validé par", value: `${validator}`, inline: true },
      { name: "Total", value: formatEuro(list.total), inline: true },
      { name: "Articles", value: itemsSummary(list.items).slice(0, 1024) },
      { name: "Budget hebdomadaire restant", value: formatEuro(getRemainingBudget(state)), inline: true }
    )
    .setTimestamp();
}

function buildRejectedEmbed(list, validator) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("❌ Liste de courses refusée")
    .addFields(
      { name: "Demandeur", value: `<@${list.authorId}>`, inline: true },
      { name: "Refusé par", value: `${validator}`, inline: true },
      { name: "Total", value: formatEuro(list.total), inline: true },
      { name: "Articles", value: itemsSummary(list.items).slice(0, 1024) }
    )
    .setTimestamp();
}

async function handleSubmitList(interaction, client) {
  const state = loadState();
  const userId = interaction.user.id;
  const draft = getDraft(state, userId);

  if (draft.items.length === 0) {
    await interaction.reply({ content: "❌ Votre liste est vide. Ajoutez des articles avant d'envoyer.", ephemeral: true });
    return;
  }

  const logChannel = await interaction.guild.channels.fetch(COURSE_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased()) {
    await interaction.reply({ content: "❌ Salon de validation introuvable.", ephemeral: true });
    return;
  }

  const list = {
    id: `course_${Date.now()}_${userId.slice(-4)}`,
    authorId: userId,
    authorTag: interaction.user.tag,
    items: draft.items,
    total: draft.total,
    status: "pending",
    createdAt: Date.now(),
    logMessageId: null,
  };

  state.lists.push(list);
  clearDraft(state, userId);
  saveState(state);

  const logMsg = await logChannel.send({
    content: `<@&${COURSE_GERANT_ROLE_ID}> — Nouvelle **liste de courses** à valider`,
    embeds: [buildPendingEmbed(list, interaction.member ?? interaction.user, state)],
    components: [buildValidationRow(list.id)],
  });

  list.logMessageId = logMsg.id;
  saveState(state);

  await interaction.reply({
    content:
      `✅ **Liste envoyée !**\n\n${itemsSummary(list.items)}\n\n**Total estimé : ${formatEuro(list.total)}**\n\n` +
      `En attente de validation par un **Gérant courses** dans <#${COURSE_LOG_CHANNEL_ID}>.`,
    ephemeral: true,
  });
}

async function validateCourseList(interaction, listId, approved) {
  if (!isGerantCourse(interaction.member)) {
    await interaction.reply({ content: "❌ Seuls les **Gérants courses** peuvent valider.", ephemeral: true });
    return;
  }

  const state = loadState();
  const list = state.lists.find((l) => l.id === listId);

  if (!list || list.status !== "pending") {
    await interaction.reply({ content: "❌ Cette liste n'est plus en attente.", ephemeral: true });
    return;
  }

  if (approved) {
    const remaining = getRemainingBudget(state);
    if (list.total > remaining) {
      await interaction.reply({
        content: `❌ **Budget hebdomadaire insuffisant.**\nMontant : ${formatEuro(list.total)}\nRestant : ${formatEuro(remaining)}`,
        ephemeral: true,
      });
      return;
    }
  }

  list.status = approved ? "approved" : "rejected";
  list.validatedAt = Date.now();
  list.validatorId = interaction.user.id;
  saveState(state);

  const embed = approved ? buildApprovedEmbed(list, interaction.member, state) : buildRejectedEmbed(list, interaction.member);
  await interaction.update({ embeds: [embed], components: [] });

  const author = await interaction.guild.members.fetch(list.authorId).catch(() => null);
  if (author) {
    await author
      .send(
        approved
          ? `✅ Votre liste de courses (**${formatEuro(list.total)}**) a été **validée**.`
          : `❌ Votre liste de courses (**${formatEuro(list.total)}**) a été **refusée**.`
      )
      .catch(() => null);
  }

  if (approved) await updateCoursePanel(interaction.client).catch(() => null);

  await interaction.followUp({
    content: approved
      ? `✅ Validé — ${formatEuro(list.total)} déduit. Budget hebdomadaire restant : ${formatEuro(getRemainingBudget(loadState()))}`
      : "❌ Liste refusée.",
    ephemeral: true,
  });
}

function startCourseScheduler(client) {
  cron.schedule(
    "0 0 * * *",
    () => {
      const state = loadState();
      const before = state.weekStart;
      ensureWeek(state);
      if (state.weekStart !== before) {
        saveState(state);
        updateCoursePanel(client).catch(() => null);
      }
    },
    { timezone: "Europe/Paris" }
  );
}

async function handleCourseInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "course") {
    if (interaction.channelId !== COURSE_CHANNEL_ID) {
      await interaction.reply({ content: `🛒 Utilisez le panel dans <#${COURSE_CHANNEL_ID}>.`, ephemeral: true });
      return true;
    }
    await interaction.showModal(buildAddModal());
    return true;
  }

  if (interaction.isButton()) {
    if (interaction.customId === BTN.ADD) {
      await interaction.showModal(buildAddModal());
      return true;
    }
    if (interaction.customId === BTN.REMOVE) {
      await handleRemovePrompt(interaction);
      return true;
    }
    if (interaction.customId === BTN.VIEW) {
      await handleViewDraft(interaction);
      return true;
    }
    if (interaction.customId === BTN.CLEAR) {
      await handleClearDraft(interaction);
      return true;
    }
    if (interaction.customId === BTN.SUBMIT) {
      await handleSubmitList(interaction, client);
      return true;
    }
    if (interaction.customId.startsWith("course_approve_")) {
      await validateCourseList(interaction, interaction.customId.slice("course_approve_".length), true);
      return true;
    }
    if (interaction.customId.startsWith("course_reject_")) {
      await validateCourseList(interaction, interaction.customId.slice("course_reject_".length), false);
      return true;
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT_REMOVE) {
    await handleRemoveSelect(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_ADD) {
    await handleAddItem(interaction);
    return true;
  }

  return false;
}

module.exports = {
  COURSE_CHANNEL_ID,
  setupCoursePanel,
  handleCourseInteraction,
  startCourseScheduler,
};
