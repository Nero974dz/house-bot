const fs = require("fs");
const cron = require("node-cron");
const { getStatePath, persistState } = require("./storage");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const COURSE_CHANNEL_ID = "1531820640246562986";
const COURSE_GERANT_ROLE_ID = "1531823144346845224";

const STATE_FILE = getStatePath("course-state.json");
const WEEKLY_BUDGET = 1200;
const PER_PERSON_CAP = 250;
const COURSE_TIMEOUT_MS = 10 * 60 * 1000;

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

function parseAmount(str) {
  return parseFloat(str.replace(",", ".").replace(/[^\d.]/g, ""));
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

function formatDateFr(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.lists)) data.lists = [];
    if (typeof data.weekStart !== "string") data.weekStart = getWeekStartISO();
    ensureWeek(data);
    return data;
  } catch {
    const state = { weekStart: getWeekStartISO(), lists: [] };
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
  }
}

function isGerantCourse(member) {
  return member?.roles.cache.has(COURSE_GERANT_ROLE_ID) ?? false;
}

function getApprovedLists(state) {
  return state.lists.filter((l) => l.status === "approved");
}

function getPendingListsForUser(state, userId) {
  return state.lists.filter((l) => l.status === "pending" && l.authorId === userId);
}

function getTotalSpent(state) {
  return getApprovedLists(state).reduce((s, l) => s + l.total, 0);
}

function getRemainingBudget(state) {
  return Math.max(0, WEEKLY_BUDGET - getTotalSpent(state));
}

function getUserSpentThisWeek(state, userId) {
  return state.lists
    .filter((l) => l.authorId === userId && (l.status === "approved" || l.status === "pending"))
    .reduce((s, l) => s + l.total, 0);
}

// --- Sessions de collecte en cours (DM), en mémoire uniquement ---
const courseSessions = new Map();

function clearCourseSession(userId) {
  const session = courseSessions.get(userId);
  if (session?.timeout) clearTimeout(session.timeout);
  courseSessions.delete(userId);
}

function scheduleCourseTimeout(userId, user) {
  const session = courseSessions.get(userId);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  session.timeout = setTimeout(async () => {
    if (!courseSessions.has(userId)) return;
    clearCourseSession(userId);
    await user.send("⏱️ Temps écoulé. Liste de courses annulée — relancez `/course`.").catch(() => null);
  }, COURSE_TIMEOUT_MS);
}

function itemsSummary(items) {
  return items
    .map((it, i) => `**${i + 1}.** ${it.name} — ${formatEuro(it.price)}${it.matched ? "" : " *(estimation)*"}`)
    .join("\n");
}

async function startCourseCommand(interaction) {
  if (interaction.channelId !== COURSE_CHANNEL_ID) {
    await interaction.reply({
      content: `🛒 Cette commande s'utilise dans <#${COURSE_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return;
  }

  if (courseSessions.has(interaction.user.id)) {
    await interaction.reply({
      content: "⏳ Vous avez déjà une liste de courses en cours. Répondez en MP ou attendez 10 min.",
      ephemeral: true,
    });
    return;
  }

  const state = loadState();
  const alreadySpent = getUserSpentThisWeek(state, interaction.user.id);
  const remainingForUser = Math.max(0, PER_PERSON_CAP - alreadySpent);

  if (remainingForUser <= 0) {
    await interaction.reply({
      content: `❌ Vous avez déjà atteint votre plafond de **${formatEuro(PER_PERSON_CAP)}** cette semaine.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.user.send(
      "🛒 **Liste de courses — nouvel article**\n\n" +
        `**Quel aliment voulez-vous ajouter ?**\n` +
        `*Répondez ici en message privé, un article à la fois. Tapez \`fin\` quand vous avez terminé.*\n\n` +
        `Plafond restant cette semaine : **${formatEuro(remainingForUser)}**`
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

  courseSessions.set(interaction.user.id, {
    guildId: interaction.guild.id,
    items: [],
    total: 0,
    timeout: null,
  });
  scheduleCourseTimeout(interaction.user.id, interaction.user);

  await interaction.reply({
    content:
      "🛒 **Message envoyé en MP.**\n" +
      "Ouvrez vos **MP avec le bot House** et ajoutez vos articles un par un.",
    ephemeral: true,
  });
}

async function finalizeCourseList(message, client, session) {
  clearCourseSession(message.author.id);

  if (session.items.length === 0) {
    await message.reply("❌ Liste vide, aucune demande envoyée.").catch(() => null);
    return;
  }

  try {
    const list = await submitCourseList(client, session.guildId, message.author, session.items, session.total);
    await message.reply(
      `✅ **Liste envoyée !**\n\n${itemsSummary(session.items)}\n\n` +
        `**Total estimé : ${formatEuro(session.total)}**\n\n` +
        `En attente de validation par un **Gérant courses** dans <#${COURSE_CHANNEL_ID}>.`
    );
  } catch (err) {
    console.error("Erreur soumission liste de courses:", err.message);
    await message.reply("❌ Erreur lors de l'envoi. Réessayez avec `/course`.").catch(() => null);
  }
}

async function handleCourseDmMessage(message, client) {
  if (message.author.bot) return false;
  if (message.guild) return false;

  const session = courseSessions.get(message.author.id);
  if (!session) return false;

  const content = message.content?.trim();
  if (!content) {
    await message.reply("❌ Réponse vide. Entrez le nom d'un aliment, ou `fin` pour terminer.").catch(() => null);
    return true;
  }

  scheduleCourseTimeout(message.author.id, message.author);

  if (["fin", "stop", "termine", "terminé", "done"].includes(normalize(content))) {
    await finalizeCourseList(message, client, session);
    return true;
  }

  const state = loadState();
  const alreadySpent = getUserSpentThisWeek(state, message.author.id);
  const remainingForUser = Math.max(0, PER_PERSON_CAP - alreadySpent - session.total);

  const { price, matched } = estimatePrice(content);

  if (price > remainingForUser) {
    await message.reply(
      `❌ **${content}** coûte environ ${formatEuro(price)}${matched ? "" : " (estimation)"}, ` +
        `ce qui dépasserait votre plafond hebdomadaire de ${formatEuro(PER_PERSON_CAP)}.\n` +
        `Il vous reste **${formatEuro(remainingForUser)}**. Ajoutez un autre article moins cher, ou tapez \`fin\` pour terminer votre liste.`
    ).catch(() => null);
    return true;
  }

  session.items.push({ name: content, price, matched });
  session.total = Math.round((session.total + price) * 100) / 100;
  const newRemaining = Math.max(0, PER_PERSON_CAP - alreadySpent - session.total);

  if (newRemaining <= 0) {
    await message.reply(
      `✅ **${content}** ajouté — environ ${formatEuro(price)}${matched ? "" : " (estimation)"}.\n\n` +
        `**Total actuel : ${formatEuro(session.total)}** — plafond de ${formatEuro(PER_PERSON_CAP)} atteint.\n` +
        `Votre liste va être envoyée automatiquement.`
    ).catch(() => null);
    await finalizeCourseList(message, client, session);
    return true;
  }

  await message.reply(
    `✅ **${content}** ajouté — environ ${formatEuro(price)}${matched ? "" : " (estimation)"}.\n\n` +
      `**Total actuel : ${formatEuro(session.total)}** (reste ${formatEuro(newRemaining)} sur votre plafond)\n\n` +
      `**Prochain aliment ?** *(ou \`fin\` pour terminer)*`
  ).catch(() => null);
  return true;
}

function buildValidationRow(listId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`course_approve_${listId}`)
      .setLabel("Valider")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`course_reject_${listId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
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

async function submitCourseList(client, guildId, user, items, total) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error("Serveur introuvable");

  const state = loadState();
  ensureWeek(state);

  const list = {
    id: `course_${Date.now()}_${user.id.slice(-4)}`,
    authorId: user.id,
    authorTag: user.tag,
    items,
    total,
    status: "pending",
    createdAt: Date.now(),
    logMessageId: null,
  };

  state.lists.push(list);
  saveState(state);

  const channel = await guild.channels.fetch(COURSE_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) throw new Error("Salon courses introuvable");

  const member = await guild.members.fetch(user.id).catch(() => null);
  const logMsg = await channel.send({
    content: `<@&${COURSE_GERANT_ROLE_ID}> — Nouvelle **liste de courses** à valider`,
    embeds: [buildPendingEmbed(list, member ?? user, state)],
    components: [buildValidationRow(list.id)],
  });

  list.logMessageId = logMsg.id;
  saveState(state);

  return list;
}

async function validateCourseList(interaction, listId, approved) {
  if (!isGerantCourse(interaction.member)) {
    await interaction.reply({
      content: "❌ Seuls les **Gérants courses** peuvent valider.",
      ephemeral: true,
    });
    return;
  }

  const state = loadState();
  ensureWeek(state);
  const list = state.lists.find((l) => l.id === listId);

  if (!list || list.status !== "pending") {
    await interaction.reply({ content: "❌ Cette liste n'est plus en attente.", ephemeral: true });
    return;
  }

  if (approved) {
    const remaining = getRemainingBudget(state);
    if (list.total > remaining) {
      await interaction.reply({
        content:
          `❌ **Budget hebdomadaire insuffisant.**\n` +
          `Montant : ${formatEuro(list.total)}\n` +
          `Restant : ${formatEuro(remaining)}`,
        ephemeral: true,
      });
      return;
    }
  }

  list.status = approved ? "approved" : "rejected";
  list.validatedAt = Date.now();
  list.validatorId = interaction.user.id;
  saveState(state);

  const embed = approved
    ? buildApprovedEmbed(list, interaction.member, state)
    : buildRejectedEmbed(list, interaction.member);

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

  await interaction.followUp({
    content: approved
      ? `✅ Validé — ${formatEuro(list.total)} déduit. Budget hebdomadaire restant : ${formatEuro(getRemainingBudget(loadState()))}`
      : "❌ Liste refusée.",
    ephemeral: true,
  });
}

function startCourseScheduler() {
  cron.schedule(
    "0 0 * * *",
    () => {
      const state = loadState();
      const before = state.weekStart;
      ensureWeek(state);
      if (state.weekStart !== before) saveState(state);
    },
    { timezone: "Europe/Paris" }
  );
}

async function handleCourseInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === "course") {
    await startCourseCommand(interaction);
    return true;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("course_approve_")) {
      const id = interaction.customId.slice("course_approve_".length);
      await validateCourseList(interaction, id, true);
      return true;
    }
    if (interaction.customId.startsWith("course_reject_")) {
      const id = interaction.customId.slice("course_reject_".length);
      await validateCourseList(interaction, id, false);
      return true;
    }
  }

  return false;
}

module.exports = {
  COURSE_CHANNEL_ID,
  handleCourseInteraction,
  handleCourseDmMessage,
  startCourseScheduler,
};
