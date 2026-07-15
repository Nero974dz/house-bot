const fs = require("fs");
const cron = require("node-cron");
const { EmbedBuilder } = require("discord.js");
const { getStatePath, persistState } = require("./storage");

const REPAS_CHANNEL_ID = "1509983930294472817";
const MEMBRE_ROLE_ID = "1509983439968010401";
const STATE_FILE = getStatePath("repas-state.json");

const MATIN = [
  "Tartines de campagne, beurre salé et confiture maison",
  "Café, croissant doré et jus d'orange pressé",
  "Bol de céréales, lait frais et banane",
  "Yaourt grec, miel et noix croquantes",
  "Omelette nature, pain grillé et tomates cerises",
  "Porridge crémeux, cannelle et fruits rouges",
  "Pain au chocolat, café allongé et compote",
  "Toast avocat, œuf mollet et graines",
  "Clafoutis aux cerises et crème fraîche",
  "Brioche du boulanger, confiture et thé",
  "Omelette fine au comté, tartines de campagne et beurre salé",
  "Brunch royal — saumon fumé, œufs Bénédicte et pancakes au sirop d'érable",
  "Granola maison, fromage blanc et mangue fraîche",
  "Gaufres liégeoises, chantilly et chocolat fondu",
  "Croque-monsieur gratiné, salade verte et café",
  "Smoothie bowl tropical, granola et noix de coco",
  "Œufs à la coque, mouillettes et beurre demi-sel",
  "Bagel cream cheese, saumon et câpres",
  "Chausson aux pommes, jus de pomme et thé vert",
  "Petit-déjeuner anglais — bacon, œufs, haricots et saucisses",
  "French toast à la vanille, sirop d'érable et fruits",
  "Assiette nordique — gravad lax, fromage et pain seigle",
];

const MIDI = [
  "Pâtes au beurre, parmesan et salade verte",
  "Sandwich jambon-beurre, chips et fruit",
  "Soupe de légumes, pain complet et fromage",
  "Salade composée, thon et œuf dur",
  "Pizza margherita et salade italienne",
  "Riz sauté aux légumes et sauce soja",
  "Croque-madame, frites maison et ketchup",
  "Taboulé libanais, falafels et houmous",
  "Burger maison, cheddar et oignons confits",
  "Quiche lorraine, mesclun et vinaigrette",
  "Pâtes fraîches à la burrata, tomates confites et basilic",
  "Plateau sushi assorti, soupe miso et salade d'algues",
  "Magret de canard, purée de patate douce et jus au miel",
  "Risotto aux truffes, copeaux de parmesan et huile de noisette",
  "Grande table — buffet froid, charcuterie fine et fromages affinés",
  "Lobster roll, frites croustillantes et sauce maison",
  "Tajine d'agneau, semoule et salade orientale",
  "Fish and chips, sauce tartare et citron",
  "Bowl poké saumon, avocat, edamame et riz vinaigré",
  "Lasagnes gratinées, salade et garlic bread",
  "Pad thaï aux crevettes, cacahuètes et citron vert",
  "Choucroute garnie traditionnelle et moutarde",
  "Buffet du chef — viandes rôties, légumes glacés et sauces",
];

const SOIR = [
  "Soupe à l'oignon gratinée et salade",
  "Omelette aux fines herbes et pain",
  "Salade César au poulet grillé",
  "Gratin dauphinois et jambon",
  "Tortilla espagnole et tomates",
  "Pâtes carbonara et roquette",
  "Velouté de potiron et croûtons",
  "Wrap poulet-crudités et yaourt",
  "Riz cantonais et nems maison",
  "Croque monsieur et soupe de légumes",
  "Entrecôte grillée, pommes grenaille et sauce aux échalotes",
  "Saumon en croûte d'herbes, légumes vapeur et beurre blanc",
  "Dîner gastronomique — foie gras, volaille truffée et dessert du chef",
  "Grand buffet du soir — hors-d'œuvres, rôtis et fromages",
  "Côte de bœuf maturée, frites et sauce béarnaise",
  "Bar en croûte de sel, légumes rôtis et citron confit",
  "Cassoulet maison et salade verte",
  "Poulet rôti, purée onctueuse et jus corsé",
  "Tartiflette savoyarde et cornichons",
  "Bouillabaisse marseillaise, rouille et croûtons",
  "Wellington de bœuf, légumes de saison et jus réduit",
  "Raclette conviviale, charcuterie et pommes de terre",
  "Plateau fruits de mer, huîtres et beurre citronné",
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { recentMenus: [], messageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("repas-state.json");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function menuSignature(matin, midi, soir) {
  return `${matin}|${midi}|${soir}`;
}

function generateUniqueMenu(state) {
  const recent = new Set(state.recentMenus || []);
  let attempts = 0;

  while (attempts < 80) {
    const matin = pickRandom(MATIN);
    const midi = pickRandom(MIDI);
    const soir = pickRandom(SOIR);
    const sig = menuSignature(matin, midi, soir);

    if (!recent.has(sig)) {
      return { matin, midi, soir, sig };
    }
    attempts++;
  }

  const matin = pickRandom(MATIN);
  const midi = pickRandom(MIDI);
  const soir = pickRandom(SOIR);
  return { matin, midi, soir, sig: menuSignature(matin, midi, soir) };
}

function formatDateFr(date) {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

function formatDateTimeFooter(date) {
  const d = formatDateFr(date);
  const t = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
  return `${d} ${t}`;
}

function buildMenuEmbed(matin, midi, soir) {
  const now = new Date();
  const dateStr = formatDateFr(now);

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🍽️ Menu du jour")
    .setDescription(`**${dateStr}**`)
    .addFields(
      { name: "☀️ Matin", value: matin, inline: false },
      { name: "🌤️ Midi", value: midi, inline: false },
      { name: "🌙 Soir", value: soir, inline: false }
    )
    .setFooter({
      text: `Menu de la Maison • ${formatDateTimeFooter(now)}`,
    });
}

async function deleteOldMenuMessage(channel, client, state) {
  if (state.messageId) {
    const old = await channel.messages.fetch(state.messageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (messages) {
    for (const msg of messages.values()) {
      if (
        msg.author.id === client.user.id &&
        msg.embeds[0]?.title === "🍽️ Menu du jour"
      ) {
        await msg.delete().catch(() => null);
      }
    }
  }
}

async function publishDailyMenu(client) {
  const channel = await client.channels.fetch(REPAS_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon repas ${REPAS_CHANNEL_ID} introuvable`);
    return;
  }

  const state = loadState();
  const { matin, midi, soir, sig } = generateUniqueMenu(state);

  await deleteOldMenuMessage(channel, client, state);

  const embed = buildMenuEmbed(matin, midi, soir);
  const sent = await channel.send({
    content: `<@&${MEMBRE_ROLE_ID}>`,
    embeds: [embed],
  });

  state.recentMenus = [sig, ...(state.recentMenus || [])].slice(0, 45);
  state.messageId = sent.id;
  state.lastDate = formatDateFr(new Date());
  saveState(state);

  console.log(`Menu du jour publié — ${state.lastDate}`);
}

function isMenuPostedToday(state) {
  const today = formatDateFr(new Date());
  return state.lastDate === today;
}

function startRepasScheduler(client) {
  cron.schedule(
    "0 6 * * *",
    () => {
      publishDailyMenu(client).catch((err) =>
        console.error("Erreur menu repas:", err.message)
      );
    },
    { timezone: "Europe/Paris" }
  );

  const state = loadState();
  if (!isMenuPostedToday(state)) {
    publishDailyMenu(client).catch((err) =>
      console.error("Erreur menu repas (démarrage):", err.message)
    );
  }

  console.log("Repas : envoi programmé chaque jour à 6h00 (Paris)");
}

module.exports = {
  REPAS_CHANNEL_ID,
  MEMBRE_ROLE_ID,
  publishDailyMenu,
  startRepasScheduler,
};
