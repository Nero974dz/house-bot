const fs = require("fs");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  SlashCommandBuilder,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const { hasEnough, removeFunds, addFunds, getBalance, formatEuro, isAccountFrozen, BLACKLIST_CASINO_ROLE_ID } = require("./bank");
const { logIrfEvent } = require("./irf-log");

const CASINO_CHANNEL_ID = "1527054335928827954";
const DUEL_CHANNEL_ID = "1509983753605349498";
const BIG_WIN_CHANNEL_ID = "1509983753605349498"; // annonce des gros gains
const CASINO_LOG_CHANNEL_ID = "1510687492896981102"; // log de toutes les parties
const BIG_WIN_THRESHOLD = 500; // gain net à partir duquel on annonce
const FONDATION_ROLE_ID = "1509974377267990659";

const STATE_FILE = getStatePath("casino-state.json");
const JACKPOT_SEED = 1000;
const BLACKJACK_RAKE = 0.03;
const ROULETTE_RAKE = 0.03;
const SLOT_RAKE = 0.03;
const DUEL_RAKE = 0.05;
const DUEL_TIMEOUT_MS = 5 * 60 * 1000;
const BLACKJACK_TIMEOUT_MS = 5 * 60 * 1000;

// ID secret — peut décider du résultat d'un duel via DM
const VIP_DUEL_ID = "320348102055690241";

// Joueur plafonné : perd toujours quand son solde (avant mise) est >= seuil
const CAPPED_ID = "1411724649036910673";
const CAPPED_THRESHOLD = 2800;
/** Retourne true si le joueur doit perdre (solde avant mise >= seuil). */
function isCapped(userId, betAmount = 0) {
  if (userId !== CAPPED_ID) return false;
  return getBalance(userId) + betAmount >= CAPPED_THRESHOLD;
}
const VIP_DUEL_WIN_PREFIX = "vip_duel_win_";
const VIP_DUEL_LOSE_PREFIX = "vip_duel_lose_";
// Map duelId → { resolve, interaction } pour attendre la décision DM
const vipDuelPending = new Map();

// Machine à sous : symboles pondérés (plus rare = plus gros gain).
const SLOT_SYMBOLS = [
  { emoji: "🍒", weight: 30, multiplier: 1.5 },
  { emoji: "🍋", weight: 25, multiplier: 2 },
  { emoji: "🔔", weight: 20, multiplier: 3 },
  { emoji: "⭐", weight: 15, multiplier: 5 },
  { emoji: "💎", weight: 8, multiplier: 10 },
  { emoji: "7️⃣", weight: 2, multiplier: "JACKPOT" },
];

function pickSlotSymbol() {
  const total = SLOT_SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let roll = Math.random() * total;
  for (const sym of SLOT_SYMBOLS) {
    if (roll < sym.weight) return sym;
    roll -= sym.weight;
  }
  return SLOT_SYMBOLS[0];
}

/**
 * Images utilisées dans les embeds. Uploadez une image dans un salon Discord,
 * clic droit > Copier le lien, et collez l'URL ici (laisser null = pas d'image).
 */
const IMAGES = {
  banner: null,
  blackjack: "https://raw.githubusercontent.com/Nero974dz/house-bot/main/bj.webp",
  rouletteSpin: "https://raw.githubusercontent.com/Nero974dz/house-bot/main/rr.gif",
  rouletteRouge: "https://raw.githubusercontent.com/Nero974dz/house-bot/main/rrr.webp",
  rouletteNoir: "https://raw.githubusercontent.com/Nero974dz/house-bot/main/rrn.gif",
  slotSpin: null, // gif de défilement (lien direct .gif requis)
  slotJackpot: null, // image affichée au jackpot (lien direct requis)
  duel: null,
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠️", "♥️", "♦️", "♣️"];

const CASINO_ACCESS_ROLE_ID = "1527534853246160967";
const CASINO_TICKET_CATEGORY_ID = "1527524331779788881";
const IRF_ROLE_ID = "1527525759793762586";
const BTN_ACCESS_REQUEST = "casino_access_request";
const MODAL_ACCESS = "casino_modal_access";
const ACCESS_ACCEPT_PREFIX = "casino_access_accept_"; // + userId
const ACCESS_REFUSE_PREFIX = "casino_access_refuse_"; // + userId
const ACCESS_VERIFY_PREFIX = "casino_access_verify_"; // + userId

const BTN = {
  BLACKJACK: "casino_blackjack",
  ROULETTE: "casino_roulette",
  SLOTS: "casino_slots",
  DUEL: "casino_duel",
  BJ_HIT: "casino_bj_hit",
  BJ_STAND: "casino_bj_stand",
};
const ROULETTE_COLOR_PREFIX = "casino_roulette_color_";
const MODAL_BLACKJACK = "casino_modal_blackjack";
const SLOT_SPINS_PREFIX = "casino_slotspins_"; // + nombre de tours
const MODAL_SLOTS_PREFIX = "casino_modal_slots_"; // + nombre de tours
const MODAL_ROULETTE_PREFIX = "casino_modal_roulette_";
const MODAL_DUEL_PREFIX = "casino_modal_duel_"; // + game:opponentId
const SELECT_DUEL_OPPONENT = "casino_select_opponent";
const DUEL_GAME_PREFIX = "casino_duelgame_"; // + game:opponentId
const DUEL_ACCEPT_PREFIX = "casino_duel_accept_";
const DUEL_DECLINE_PREFIX = "casino_duel_decline_";
const RPS_PREFIX = "casino_rps_"; // + duelId:choix
const C4_PREFIX = "casino_c4_"; // + duelId:colonne
const BJ1V1_HIT_PREFIX = "casino_bj1_hit_"; // + duelId
const BJ1V1_STAND_PREFIX = "casino_bj1_stand_"; // + duelId
const SCRABBLE_WORD_PREFIX = "casino_scrab_"; // + duelId (ouvre la modale)
const MODAL_SCRABBLE_PREFIX = "casino_modal_scrab_"; // + duelId

const GAME_NAMES = {
  coinflip: "Pile ou face",
  rps: "Pierre-Feuille-Ciseaux",
  c4: "Puissance 4",
  bj1v1: "Blackjack 1v1",
  scrabble: "Scrabble (meilleur mot)",
};

// Valeurs des lettres au Scrabble (français)
const SCRABBLE_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 10, L: 1,
  M: 2, N: 1, O: 1, P: 3, Q: 8, R: 1, S: 1, T: 1, U: 1, V: 4, W: 10, X: 10,
  Y: 10, Z: 10,
};
// Tirage pondéré des lettres (fréquences proches du vrai Scrabble français)
const SCRABBLE_BAG =
  "AAAAAAAAAEEEEEEEEEEEEEEEIIIIIIIINNNNNNOOOOOORRRRRRSSSSSSTTTTTTUUUUUULLLLLDDDMMMGGBBCCPPFFHHVVJKQWXYZ";

function drawScrabbleLetters(n = 7) {
  const letters = [];
  for (let i = 0; i < n; i++) {
    letters.push(SCRABBLE_BAG[Math.floor(Math.random() * SCRABBLE_BAG.length)]);
  }
  return letters;
}

// Liste de mots français valides (courants, simples)
const MOTS_VALIDES = new Set([
  "AMI","AMIE","AMIS","AME","AMES","AN","ANS","ARC","ARCS","ART","ARTS",
  "AS","AU","AUX","AVE","AXE","AXES","BAS","BAL","BAT","BLE","BON","BONS",
  "BOT","BUS","BUT","BUTS","CAR","CAS","CEL","CES","CLE","CLES","COL","COLS",
  "COU","COUP","CRI","CRIS","CRU","CRUe","DAL","DAM","DES","DEU","DIX","DUO",
  "EAU","EAUX","ELU","ELUS","EMU","EMUS","ERA","EST","ETE","ETES","EUX",
  "FAC","FAN","FANS","FAR","FEU","FEUX","FIL","FILS","FIN","FINS","FIS",
  "FIT","FOI","FON","FOU","FOUS","FRU","FUT","FUTS","GAL","GAZ","GEL","GELS",
  "GIT","GOT","GUS","ICI","ILE","ILES","ILS","JAB","JAR","JET","JETS","JEU",
  "JEUX","JUS","LAC","LACS","LAI","LAS","LES","LIT","LITS","LOI","LOIS",
  "LOT","LOTS","LOU","LUE","LUI","LUN","LUT","MAI","MAL","MALS","MAN","MER",
  "MERS","MET","METS","MIL","MIS","MOI","MON","MOT","MOTS","MOU","MUS","MUT",
  "NAN","NEF","NEO","NET","NETS","NEU","NID","NIDS","NIT","NON","NOR","NOS",
  "NOT","NUE","NUL","NULS","ODE","ODES","OIE","OIES","OLE","ONU","ONT","OPE",
  "ORA","ORB","ORC","ORE","ORF","ORS","OSE","OTE","OUI","OUR","PAC","PAI",
  "PAN","PANS","PAR","PAS","PAT","PAU","PAX","PEU","PIE","PIES","PIN","PINS",
  "PIS","PIT","PIU","PLI","PLIS","POI","POL","PON","POT","POTS","POU","POUX",
  "PRE","PRES","PRO","PROS","PUB","PUBS","PUR","PURS","PUS","RAI","RAN","RAS",
  "RAT","RATS","REC","REI","REL","REM","REN","REP","RES","REU","REV","REX",
  "RIZ","ROC","ROCS","ROI","ROIS","ROM","RON","ROS","ROT","ROU","RUE","RUES",
  "SAC","SACS","SAI","SAL","SAP","SAR","SAT","SEL","SELS","SET","SETS","SEU",
  "SIC","SIS","SIT","SIX","SKI","SKIS","SOI","SOL","SOLS","SON","SONS","SOT",
  "SOU","SOUS","SUD","SUI","SUR","TAC","TAI","TAL","TAN","TAP","TAR","TAS",
  "TAU","TEL","TEN","TES","THE","TIC","TICS","TIR","TIRS","TOI","TON","TONS",
  "TOP","TOPS","TOT","TOU","TRI","TRIS","TUB","TUBS","TUE","TUN","TUS","TUT",
  "UNE","UNI","UNIS","URE","USE","USES","VAL","VAN","VAR","VAS","VEU","VIA",
  "VIE","VIES","VIN","VINS","VIS","VIT","VIX","VOI","VOL","VOLS","VOS","VOU",
  "VUE","VUES","VUS","YEN","YENS","ZAP","ZEN","ZIP","ZIT","ZOO","ZOOS",
  // mots de 4-5 lettres courants
  "ARME","ARMES","AIDE","AIDES","AIRE","AIRS","AISE","AIME","AIGU","AILE",
  "AILES","AOUT","APRE","APRES","ASIE","BAIN","BAINS","BALE","BALL","BAND",
  "BASE","BASES","BEAU","BEAUX","BETE","BETES","BIEN","BIER","BILE","BISE",
  "BORD","BORDS","BRAS","BREF","BRIN","BRINS","BRUN","BRUNE","CAGE","CAGES",
  "CAKE","CALE","CANE","CAPE","CARA","CARE","CASE","CAVE","CELA","CENT",
  "CEUX","CHAR","CHAT","CHEF","CHER","CHEZ","CHOC","CITE","CITE","CLEF",
  "CODE","CODES","COIN","COIN","COLA","COMA","COME","CONE","COPE","CORE",
  "COTE","COUP","COUR","CRIE","CURE","DAME","DAMES","DARE","DEJA","DELE",
  "DEMI","DENS","VENT","VENTS","VIDE","VIDES","VILE","VILS","VITE","VOIE",
  "VOIES","VOIR","VOLE","VOLS","VRAI","VRAIS","ZONE","ZONES","ZERO","ZEROS",
  "TOUR","TOURS","TOIT","TOITS","SOIR","SOINS","ROSE","ROBE","ROUE","ROUES",
  "PEUR","PEURS","PORTE","PONT","PONTS","PLAT","PLATS","PLAN","PLANS","PIAF",
  "PARC","PARCS","PARE","PART","PARTS","PAYS","PEAU","PEAUX","PERE","PERES",
  "LIEU","LIEUX","LIEN","LIENS","LAME","LAMES","LAIT","LAIE","LEGE","LENT",
  "LAVE","LARD","LARGE","LACE","LUXE","LUNE","LUNES","LUGE","LUEUR","LOUE",
  "MAXI","MARE","MARES","MARI","MARS","MERE","MERES","MINE","MINES","MODE",
  "MODES","MOIS","MOLE","MONT","MONTS","MORT","MORTS","MOUE","MOUES","MULE",
  "NUIT","NUITS","NOME","NOME","NOTE","NOTES","NOUE","NOUS","NOIX","NOIR",
  "NOIRE","LUNE","FUME","FUMES","FUSE","FUTE","GALE","GANT","GANTS","GARE",
  "GARES","GATE","GAVE","GAZON","GAZE","GELE","GENE","GENS","GITE","GITES",
  "GAVE","JUPE","JUPES","JOUE","JOUES","JOUR","JOURS","JOIE","JOIES",
  "HAUT","HAUTS","HERO","HEROS","HIER","HOTE","HOTES","HURE",
  "FACE","FACES","FADE","FAIM","FAIRE","FAIT","FAITS","FAME","FARD","FARE",
  "SEAU","SEAUX","SEUL","SEULE","SEXE","SIGE","SITE","SITES","SOLE","SOLES",
  "SOIE","SOIES","SORT","SORTS","SOTE","SOUS","SURE","SURS","SUIT","SUITE",
  "TARE","TARES","TACT","TACTS","TALE","TELE","TENU","TENUE","TIGE","TIGES",
  "TIRE","TOME","TOMES","TORE","TORT","TORTS","TOUE","TOUES","TOUX",
  "RACE","RACES","RAGE","RAGES","RAIE","RAIES","RAME","RAMES","RANG","RANGS",
  "RAPE","RARE","RATE","RAVE","REAL","REEL","REIN","REINS","RENE","REVE",
  "REVES","RIEN","RIME","RIME","RITE","RITES","RIVE","RIVES","ROLE","ROLES",
]);

function isMotValide(word) {
  return MOTS_VALIDES.has(word.toUpperCase());
}

/** Vérifie qu'un mot n'utilise que les lettres disponibles (avec doublons). */
function canFormWord(word, rack) {
  const avail = {};
  for (const l of rack) avail[l] = (avail[l] || 0) + 1;
  for (const l of word) {
    if (!avail[l]) return false;
    avail[l]--;
  }
  return true;
}

function scrabbleScore(word) {
  return [...word].reduce((s, l) => s + (SCRABBLE_VALUES[l] || 0), 0);
}

const RPS_EMOJI = { pierre: "🪨", feuille: "📄", ciseaux: "✂️" };
function rpsBeats(a, b) {
  return (
    (a === "pierre" && b === "ciseaux") ||
    (a === "ciseaux" && b === "feuille") ||
    (a === "feuille" && b === "pierre")
  );
}

const C4_ROWS = 5;
const C4_COLS = 5;
const C4_WIN = 4;
const C4_NUMS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const C4_MARK = { 0: "⚪", 1: "🔴", 2: "🟡" };

function c4NewBoard() {
  return Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(0));
}
function c4Drop(board, col, player) {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) {
      board[r][col] = player;
      return r;
    }
  }
  return -1; // colonne pleine
}
function c4CheckWin(board, player) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of dirs) {
        let k = 1;
        while (k < C4_WIN) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS || board[nr][nc] !== player) break;
          k++;
        }
        if (k === C4_WIN) return true;
      }
    }
  }
  return false;
}
function c4IsFull(board) {
  return board.every((row) => row.every((c) => c !== 0));
}
function c4Render(board) {
  const grid = board.map((row) => row.map((c) => C4_MARK[c]).join("")).join("\n");
  return `${grid}\n${C4_NUMS.slice(0, C4_COLS).join("")}`;
}
function c4ButtonsRow(duelId, board) {
  const row = new ActionRowBuilder();
  for (let c = 0; c < C4_COLS; c++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${C4_PREFIX}${duelId}:${c}`)
        .setLabel(String(c + 1))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(board[0][c] !== 0)
    );
  }
  return row;
}

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (typeof data.jackpot !== "number") data.jackpot = JACKPOT_SEED;
    if (!Array.isArray(data.duels)) data.duels = [];
    if (!data.blackjack || typeof data.blackjack !== "object") data.blackjack = {};
    return data;
  } catch {
    return { messageId: null, jackpot: JACKPOT_SEED, duels: [], blackjack: {} };
  }
}

// --- Sessions blackjack persistées (survivent aux redémarrages) ---
function getBjSession(userId) {
  const state = loadState();
  return state.blackjack[userId] || null;
}

function setBjSession(userId, session) {
  const state = loadState();
  state.blackjack[userId] = session;
  saveState(state);
}

function removeBjSession(userId) {
  const state = loadState();
  if (state.blackjack[userId]) {
    delete state.blackjack[userId];
    saveState(state);
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("casino-state.json");
}

function parseAmount(str) {
  return parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addJackpot(amount) {
  const state = loadState();
  state.jackpot = round2(state.jackpot + amount);
  saveState(state);
  return state;
}

function buildCasinoEmbed(state) {
  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🎰 Casino de la Maison")
    .setDescription(
      "Bienvenue au casino ! Votre solde vient de **`/bank`**.\n\n" +
        "🃏 **Blackjack** — battez le croupier sans dépasser 21. Blackjack naturel payé 6:5 (x2,2).\n" +
        "🎡 **Roulette** — Rouge/Noir (x2) ou Vert (x14).\n" +
        "🎰 **Machine à sous** — 3 symboles, plus rare = plus gros gain. Enchaînez **x5 / x10 tours** d'un coup. Trois 7️⃣ font tomber le **jackpot** !\n" +
        "⚔️ **Défi** — Misez directement contre un autre membre, le gagnant rafle la mise (moins la taxe de la maison).\n\n" +
        "*La maison garde toujours un avantage. Le jackpot progressif se gagne aux 3× 7️⃣ de la machine à sous.*"
    )
    .addFields({
      name: "💰 Jackpot progressif",
      value: `**${formatEuro(state.jackpot)}**`,
    })
    .setTimestamp();

  if (IMAGES.banner) embed.setImage(IMAGES.banner);
  return embed;
}

function buildCasinoComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.BLACKJACK)
        .setLabel("Blackjack")
        .setEmoji("🃏")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BTN.ROULETTE)
        .setLabel("Roulette")
        .setEmoji("🎡")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BTN.SLOTS)
        .setLabel("Machine à sous")
        .setEmoji("🎰")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BTN.DUEL)
        .setLabel("Défier un membre")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_ACCESS_REQUEST)
        .setLabel("Demander l'accès au casino")
        .setEmoji("🎟️")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function hasCasinoAccess(member) {
  return member?.roles.cache.has(CASINO_ACCESS_ROLE_ID) ?? false;
}

async function updateCasinoMessage(client, state) {
  const channel = await client.channels.fetch(CASINO_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = buildCasinoEmbed(state);
  const components = buildCasinoComponents();

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }

  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const candidates = messages?.filter(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === "🎰 Casino de la Maison"
    );
    if (candidates?.size) {
      const sorted = [...candidates.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      msg = sorted[0];
      for (const dup of sorted.slice(1)) {
        await dup.delete().catch(() => null);
      }
    }
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

async function setupCasinoPanel(client) {
  // Nettoyer les sessions blackjack bloquées (timeouts perdus au redémarrage)
  const state = loadState();
  const stuck = Object.keys(state.blackjack || {});
  if (stuck.length > 0) {
    for (const userId of stuck) {
      const session = state.blackjack[userId];
      // Log la perte (mise déjà débitée avant le redémarrage)
      const { logIrfEvent } = require("./irf-log");
      logIrfEvent({
        userId,
        type: "💀 Défaite Casino",
        game: "Blackjack (session expirée)",
        stake: session.amount,
        amount: -session.amount,
        byId: "casino",
        date: Date.now(),
      });
    }
    state.blackjack = {};
    saveState(state);
    console.log(`[Casino] ${stuck.length} session(s) blackjack bloquée(s) nettoyée(s) au démarrage.`);
  }
  await updateCasinoMessage(client, state);
}

function buildAmountModal(customId, title, label = "Montant à miser (€)") {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("montant")
          .setLabel(label)
          .setPlaceholder("Ex. 50")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function buildRouletteColorRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}rouge`)
      .setLabel("Rouge (x2)")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}noir`)
      .setLabel("Noir (x2)")
      .setEmoji("⚫")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ROULETTE_COLOR_PREFIX}vert`)
      .setLabel("Vert (x14)")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success)
  );
}

// --- Blackjack ---

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardBaseValue(rank) {
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function handTotal(hand) {
  let total = hand.reduce((s, c) => s + cardBaseValue(c.rank), 0);
  let aces = hand.filter((c) => c.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function formatHand(hand) {
  return hand.map(formatCard).join(" ");
}

function buildBlackjackEmbed({ player, dealer, amount, hideDealer, status, resultLine }) {
  const embed = new EmbedBuilder()
    .setColor(status === "playing" ? 0x2c3e50 : status === "win" ? 0x2ecc71 : status === "push" ? 0xf1c40f : 0xe74c3c)
    .setTitle("🃏 Blackjack")
    .addFields(
      {
        name: "Votre main",
        value: `${formatHand(player)}  =  **${handTotal(player)}**`,
      },
      {
        name: "Main du croupier",
        value: hideDealer
          ? `${formatCard(dealer[0])} 🂠  =  **${handTotal([dealer[0]])} + ?**`
          : `${formatHand(dealer)}  =  **${handTotal(dealer)}**`,
      },
      { name: "Mise", value: formatEuro(amount), inline: true }
    )
    .setTimestamp();

  if (resultLine) embed.setDescription(resultLine);
  if (IMAGES.blackjack) embed.setImage(IMAGES.blackjack);
  return embed;
}

function buildBlackjackRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.BJ_HIT)
      .setLabel("Tirer")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(BTN.BJ_STAND)
      .setLabel("Rester")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

// Handles de timeout gardés en mémoire (best-effort ; perdus au redémarrage,
// mais la partie elle-même est persistée dans casino-state.json).
const bjTimeouts = new Map();

function clearBjSession(userId) {
  const timeout = bjTimeouts.get(userId);
  if (timeout) {
    clearTimeout(timeout);
    bjTimeouts.delete(userId);
  }
  removeBjSession(userId);
}

function scheduleBjTimeout(userId, respondTimeout) {
  const existing = bjTimeouts.get(userId);
  if (existing) clearTimeout(existing);
  const timeout = setTimeout(async () => {
    if (!getBjSession(userId)) return;
    await respondTimeout(userId).catch(() => null);
  }, BLACKJACK_TIMEOUT_MS);
  bjTimeouts.set(userId, timeout);
}

/** Résout la partie (push/win/lose) et paie. Renvoie {embed, jackpotHit}. */
async function settleBlackjack(client, userId) {
  const session = getBjSession(userId);
  const { player, dealer, amount } = session;
  const playerTotal = handTotal(player);
  const dealerTotal = handTotal(dealer);
  const isNaturalBJ = player.length === 2 && playerTotal === 21;

  let status;
  let resultLine;
  let payout = 0;

  if (playerTotal > 21) {
    status = "lose";
    resultLine = `💥 Vous dépassez 21. Perdu (${formatEuro(amount)}).`;
  } else if (isNaturalBJ && dealerTotal === 21) {
    status = "push";
    payout = amount;
    resultLine = `🤝 Égalité (blackjack des deux côtés). Mise remboursée (${formatEuro(amount)}).`;
  } else if (isNaturalBJ) {
    payout = round2(amount * 2.2);
    status = "win";
    resultLine = `🎉 **Blackjack naturel !** Vous gagnez **${formatEuro(payout)}** (x2,2 — 6:5).`;
  } else if (dealerTotal > 21) {
    payout = round2(amount * 2);
    status = "win";
    resultLine = `✅ Le croupier dépasse 21. Vous gagnez **${formatEuro(payout)}**.`;
  } else if (playerTotal > dealerTotal) {
    payout = round2(amount * 2);
    status = "win";
    resultLine = `✅ Vous battez le croupier (${playerTotal} contre ${dealerTotal}). Vous gagnez **${formatEuro(payout)}**.`;
  } else if (playerTotal === dealerTotal) {
    status = "push";
    payout = amount;
    resultLine = `🤝 Égalité (${playerTotal} partout). Mise remboursée (${formatEuro(amount)}).`;
  } else {
    status = "lose";
    resultLine = `❌ Le croupier gagne (${dealerTotal} contre ${playerTotal}). Perdu (${formatEuro(amount)}).`;
  }

  if (payout > 0) addFunds(userId, payout);

  // Log IRF
  const bjNet = payout > 0 ? round2(payout - amount) : -amount;
  logIrfEvent({ userId, type: bjNet >= 0 ? "🏆 Victoire Casino" : "💀 Défaite Casino", game: "Blackjack", stake: amount, amount: bjNet, byId: "casino" });

  clearBjSession(userId);
  await updateCasinoMessage(client, loadState());

  const embed = buildBlackjackEmbed({ player, dealer, amount, hideDealer: false, status, resultLine });
  embed.addFields({ name: "💰 Votre solde", value: formatEuro(getBalance(userId)), inline: true });

  await reportCasinoResult(client, {
    userId,
    game: "Blackjack",
    stake: amount,
    payout,
    detail: `Vous : ${formatHand(player)} (${playerTotal}) — Croupier : ${formatHand(dealer)} (${dealerTotal})`,
  });

  return embed;
}

async function startBlackjack(interaction, client, amount) {
  if (!hasEnough(interaction.user.id, amount)) {
    await interaction.editReply({ content: "❌ Solde insuffisant. Vérifiez `/bank`." });
    return;
  }

  removeFunds(interaction.user.id, amount);
  addJackpot(round2(amount * BLACKJACK_RAKE));

  const deck = buildDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const capped = isCapped(interaction.user.id, amount);

  setBjSession(interaction.user.id, { deck, player, dealer, amount, startedAt: Date.now(), capped });
  scheduleBjTimeout(interaction.user.id, async (userId) => {
    const embed = await settleBlackjack(client, userId);
    await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
  });

  if (handTotal(player) === 21) {
    if (capped) {
      // Forcer le croupier à avoir aussi 21 (égalité) — ajouter des cartes pour atteindre 21
      const session = getBjSession(interaction.user.id);
      while (handTotal(session.dealer) < 21 && session.deck.length > 0) {
        const dealerNow = handTotal(session.dealer);
        const needed = 21 - dealerNow;
        const exact = session.deck.find(c => cardBaseValue(c.rank) === needed);
        const under = session.deck
          .filter(c => cardBaseValue(c.rank) < needed)
          .sort((a, b) => cardBaseValue(b.rank) - cardBaseValue(a.rank))[0];
        const chosen = exact || under || session.deck[session.deck.length - 1];
        const idx = session.deck.indexOf(chosen);
        if (idx !== -1) session.deck.splice(idx, 1);
        session.dealer.push(chosen);
      }
      setBjSession(interaction.user.id, session);
    }
    const embed = await settleBlackjack(client, interaction.user.id);
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  await interaction.editReply({
    embeds: [buildBlackjackEmbed({ player, dealer, amount, hideDealer: true, status: "playing" })],
    components: [buildBlackjackRow()],
  });
}

// --- Logs & annonces ---

/** Log d'une VICTOIRE au casino (les pertes et remboursements ne sont pas loggués). */
async function logCasinoPlay(client, { userId, game, stake, payout, detail }) {
  const net = round2(payout - stake);
  if (net <= 0) return; // on ne garde que les victoires

  const channel = await client.channels.fetch(CASINO_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🏆 Victoire au casino")
    .addFields(
      { name: "Joueur", value: `<@${userId}>`, inline: true },
      { name: "Jeu", value: game, inline: true },
      { name: "Misé", value: formatEuro(stake), inline: true },
      { name: "Gagné", value: formatEuro(payout), inline: true },
      { name: "Gain net", value: `🟢 +${formatEuro(net)}`, inline: true },
      { name: "Solde après", value: formatEuro(getBalance(userId)), inline: true }
    )
    .setTimestamp();
  if (detail) embed.setDescription(detail.slice(0, 2000));

  await channel.send({ embeds: [embed] }).catch(() => null);
}

/** Annonce publique si le gain net dépasse le seuil. */
async function announceBigWin(client, { userId, game, net, detail }) {
  if (net <= BIG_WIN_THRESHOLD) return;
  const channel = await client.channels.fetch(BIG_WIN_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("💰 GROS GAIN !")
    .setDescription(
      `🎉 <@${userId}> vient de remporter **${formatEuro(net)}** au **${game}** !` +
        (detail ? `\n\n${detail.slice(0, 500)}` : "")
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

/** Logge la partie et annonce si c'est un gros gain. */
async function reportCasinoResult(client, { userId, game, stake, payout, detail }) {
  await logCasinoPlay(client, { userId, game, stake, payout, detail });
  const net = round2(payout - stake);
  if (net > BIG_WIN_THRESHOLD) {
    await announceBigWin(client, { userId, game, net, detail });
  }
}

// --- Machine à sous ---

function buildSlotSpinsRow() {
  return new ActionRowBuilder().addComponents(
    [1, 5, 10].map((n) =>
      new ButtonBuilder()
        .setCustomId(`${SLOT_SPINS_PREFIX}${n}`)
        .setLabel(n === 1 ? "1 tour" : `x${n} tours`)
        .setEmoji("🎰")
        .setStyle(n === 1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
    )
  );
}

/** Tire 3 rouleaux et calcule le gain (hors jackpot, traité par l'appelant). */
function resolveSpin(amount, forceLose = false) {
  let reels = [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
  // Plafonné : garantir une perte (3 symboles tous différents, aucune paire)
  if (forceLose) {
    while (true) {
      const a = reels[0].emoji, b = reels[1].emoji, c = reels[2].emoji;
      if (a !== b && b !== c && a !== c) break;
      reels = [pickSlotSymbol(), pickSlotSymbol(), pickSlotSymbol()];
    }
  }

  const allSame = reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji;
  const twoSame =
    reels[0].emoji === reels[1].emoji ||
    reels[1].emoji === reels[2].emoji ||
    reels[0].emoji === reels[2].emoji;

  if (allSame && reels[0].multiplier === "JACKPOT") {
    return { reels, won: 0, isJackpot: true, kind: "jackpot" };
  }
  if (allSame) {
    return { reels, won: round2(amount * reels[0].multiplier), isJackpot: false, kind: "triple" };
  }
  if (twoSame) {
    return { reels, won: amount, isJackpot: false, kind: "paire" };
  }
  return { reels, won: 0, isJackpot: false, kind: "perdu" };
}

/** Verse le jackpot au joueur et le réinitialise. Renvoie le montant gagné. */
function awardJackpot(userId) {
  const state = loadState();
  const won = state.jackpot;
  addFunds(userId, won);
  state.jackpot = JACKPOT_SEED;
  saveState(state);
  return won;
}

async function playSlots(interaction, client, amount, spins = 1) {
  const totalStake = round2(amount * spins);

  if (!hasEnough(interaction.user.id, totalStake)) {
    await interaction.editReply({
      content: `❌ Solde insuffisant : il faut **${formatEuro(totalStake)}** pour ${spins} tour(s). Vérifiez \`/bank\`.`,
    });
    return;
  }

  removeFunds(interaction.user.id, totalStake);
  addJackpot(round2(totalStake * SLOT_RAKE));

  // --- Un seul tour : avec animation ---
  if (spins === 1) {
    const spinEmbed = (line) => {
      const e = new EmbedBuilder()
        .setColor(0xe91e63)
        .setTitle("🎰 Machine à sous")
        .setDescription(`[ ${line} ]\nÇa tourne…`);
      if (IMAGES.slotSpin) e.setImage(IMAGES.slotSpin);
      return e;
    };

    await interaction.editReply({ content: "", embeds: [spinEmbed("❓ | ❓ | ❓")] });
    await sleep(800);

    const spin = resolveSpin(amount, isCapped(interaction.user.id, totalStake));
    const [r0, r1, r2] = spin.reels;
    await interaction.editReply({ embeds: [spinEmbed(`${r0.emoji} | ❓ | ❓`)] });
    await sleep(800);
    await interaction.editReply({ embeds: [spinEmbed(`${r0.emoji} | ${r1.emoji} | ❓`)] });
    await sleep(800);

    const line = spin.reels.map((r) => r.emoji).join(" | ");
    let resultText;
    let color = 0xe74c3c;
    let payout = 0;

    if (spin.isJackpot) {
      const won = awardJackpot(interaction.user.id);
      payout = won;
      resultText = `💥🎉 **JACKPOT !!!** 🎉💥\nVous remportez **${formatEuro(won)}** !`;
      color = 0xf1c40f;
    } else if (spin.kind === "triple") {
      addFunds(interaction.user.id, spin.won);
      payout = spin.won;
      resultText = `✅ Trois **${r0.emoji}** ! Vous gagnez **${formatEuro(spin.won)}** (x${r0.multiplier}).`;
      color = 0x2ecc71;
    } else if (spin.kind === "paire") {
      addFunds(interaction.user.id, spin.won);
      payout = spin.won;
      resultText = `➖ Paire ! Mise remboursée (${formatEuro(amount)}).`;
      color = 0x95a5a6;
    } else {
      resultText = `❌ Perdu. Mise : ${formatEuro(amount)}.`;
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(color)
      .setTitle("🎰 Machine à sous")
      .setDescription(`[ ${line} ]\n\n${resultText}`)
      .addFields({ name: "💰 Votre solde", value: formatEuro(getBalance(interaction.user.id)), inline: true });
    if (spin.isJackpot && IMAGES.slotJackpot) resultEmbed.setImage(IMAGES.slotJackpot);
    else if (IMAGES.slotSpin) resultEmbed.setImage(IMAGES.slotSpin);

    await updateCasinoMessage(client, loadState());
    await interaction.editReply({ embeds: [resultEmbed] });
    await reportCasinoResult(client, {
      userId: interaction.user.id,
      game: "Machine à sous",
      stake: totalStake,
      payout,
      detail: `[ ${line} ]`,
    });
    return;
  }

  // --- Plusieurs tours : récapitulatif, sans animation ---
  await interaction.editReply({ content: "", embeds: [
    new EmbedBuilder()
      .setColor(0xe91e63)
      .setTitle("🎰 Machine à sous")
      .setDescription(`🎲 ${spins} tours à ${formatEuro(amount)}… ça tourne !`),
  ] });
  await sleep(1000);

  let totalWon = 0;
  let jackpotWon = 0;
  const lines = [];

  const capped = isCapped(interaction.user.id, totalStake);
  for (let i = 0; i < spins; i++) {
    const spin = resolveSpin(amount, capped);
    const line = spin.reels.map((r) => r.emoji).join(" ");

    if (spin.isJackpot) {
      const won = awardJackpot(interaction.user.id);
      jackpotWon += won;
      totalWon = round2(totalWon + won);
      lines.push(`${line} → 💥 **JACKPOT ${formatEuro(won)}**`);
    } else if (spin.kind === "triple") {
      addFunds(interaction.user.id, spin.won);
      totalWon = round2(totalWon + spin.won);
      lines.push(`${line} → ✅ **+${formatEuro(spin.won)}**`);
    } else if (spin.kind === "paire") {
      addFunds(interaction.user.id, spin.won);
      totalWon = round2(totalWon + spin.won);
      lines.push(`${line} → ➖ remboursé`);
    } else {
      lines.push(`${line} → ❌`);
    }
  }

  const net = round2(totalWon - totalStake);
  logIrfEvent({ userId: interaction.user.id, type: net >= 0 ? "🏆 Victoire Casino" : "💀 Défaite Casino", game: "Machine à sous", stake: totalStake, amount: net, byId: "casino" });
  const color = jackpotWon > 0 ? 0xf1c40f : net > 0 ? 0x2ecc71 : net === 0 ? 0x95a5a6 : 0xe74c3c;

  const resultEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎰 Machine à sous — ${spins} tours`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .addFields(
      { name: "Total misé", value: formatEuro(totalStake), inline: true },
      { name: "Total gagné", value: formatEuro(totalWon), inline: true },
      {
        name: "Résultat net",
        value: `${net >= 0 ? "🟢 +" : "🔴 "}${formatEuro(net)}`,
        inline: true,
      },
      { name: "💰 Votre solde", value: formatEuro(getBalance(interaction.user.id)), inline: true }
    );
  if (jackpotWon > 0 && IMAGES.slotJackpot) resultEmbed.setImage(IMAGES.slotJackpot);

  await updateCasinoMessage(client, loadState());
  await interaction.editReply({ embeds: [resultEmbed] });
  await reportCasinoResult(client, {
    userId: interaction.user.id,
    game: `Machine à sous (${spins} tours)`,
    stake: totalStake,
    payout: totalWon,
    detail: jackpotWon > 0 ? `💥 Jackpot décroché : ${formatEuro(jackpotWon)}` : null,
  });
}

// --- Roulette ---

async function playRoulette(interaction, client, color, amount) {
  if (!hasEnough(interaction.user.id, amount)) {
    await interaction.editReply({ content: "❌ Solde insuffisant. Vérifiez `/bank`." });
    return;
  }

  removeFunds(interaction.user.id, amount);
  addJackpot(round2(amount * ROULETTE_RAKE));

  const spinEmbed = new EmbedBuilder()
    .setColor(0x2c3e50)
    .setTitle("🎡 Roulette")
    .setDescription("La bille tourne…");
  if (IMAGES.rouletteSpin) spinEmbed.setImage(IMAGES.rouletteSpin);
  await interaction.editReply({ content: "", embeds: [spinEmbed] });
  await sleep(1200);

  let number = Math.floor(Math.random() * 37);
  // Plafonné : forcer un numéro qui ne correspond PAS à la couleur choisie
  if (isCapped(interaction.user.id, amount)) {
    if (color === "vert") {
      // Forcer un numéro non-zéro
      number = Math.floor(Math.random() * 36) + 1;
    } else if (color === "rouge") {
      // Forcer un numéro noir ou zéro
      const nonRouge = Array.from({ length: 37 }, (_, i) => i).filter(n => !RED_NUMBERS.has(n));
      number = nonRouge[Math.floor(Math.random() * nonRouge.length)];
    } else {
      // Forcer un numéro rouge ou zéro
      const nonNoir = [0, ...RED_NUMBERS];
      number = nonNoir[Math.floor(Math.random() * nonNoir.length)];
    }
  }
  const resultColor = number === 0 ? "vert" : RED_NUMBERS.has(number) ? "rouge" : "noir";
  const colorEmoji = { rouge: "🔴", noir: "⚫", vert: "🟢" };
  const multiplier = { rouge: 2, noir: 2, vert: 14 }[color];

  const embed = new EmbedBuilder()
    .setColor(color === resultColor ? 0x2ecc71 : 0xe74c3c)
    .setTitle("🎡 Roulette")
    .setDescription(`La bille s'arrête sur **${number}** ${colorEmoji[resultColor]}`);

  if (resultColor === "rouge" && IMAGES.rouletteRouge) embed.setImage(IMAGES.rouletteRouge);
  else if (resultColor === "noir" && IMAGES.rouletteNoir) embed.setImage(IMAGES.rouletteNoir);
  else if (IMAGES.rouletteSpin) embed.setImage(IMAGES.rouletteSpin);

  let payout = 0;
  if (color === resultColor) {
    const won = round2(amount * multiplier);
    addFunds(interaction.user.id, won);
    payout = won;
    embed.addFields({ name: "Résultat", value: `✅ Gagné ! Vous remportez **${formatEuro(won)}** (x${multiplier}).` });
  } else {
    embed.addFields({ name: "Résultat", value: `❌ Perdu. Mise : ${formatEuro(amount)}.` });
  }

  const rouletteNet = payout > 0 ? round2(payout - amount) : -amount;
  logIrfEvent({ userId: interaction.user.id, type: rouletteNet >= 0 ? "🏆 Victoire Casino" : "💀 Défaite Casino", game: "Roulette", stake: amount, amount: rouletteNet, byId: "casino" });

  embed.addFields({ name: "💰 Votre solde", value: formatEuro(getBalance(interaction.user.id)), inline: true });

  await updateCasinoMessage(client, loadState());
  await interaction.editReply({ content: "", embeds: [embed] });
  await reportCasinoResult(client, {
    userId: interaction.user.id,
    game: "Roulette",
    stake: amount,
    payout,
    detail: `Mise sur **${color}** — sortie : **${number}** ${colorEmoji[resultColor]}`,
  });
}

// --- Duel PvP ---

function buildGameSelectRow(opponentId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUEL_GAME_PREFIX}coinflip:${opponentId}`)
      .setLabel("Pile ou face")
      .setEmoji("🪙")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DUEL_GAME_PREFIX}rps:${opponentId}`)
      .setLabel("Pierre-Feuille-Ciseaux")
      .setEmoji("✊")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DUEL_GAME_PREFIX}c4:${opponentId}`)
      .setLabel("Puissance 4")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DUEL_GAME_PREFIX}bj1v1:${opponentId}`)
      .setLabel("Blackjack")
      .setEmoji("🃏")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DUEL_GAME_PREFIX}scrabble:${opponentId}`)
      .setLabel("Scrabble")
      .setEmoji("🔡")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildRpsRow(duelId) {
  return new ActionRowBuilder().addComponents(
    ["pierre", "feuille", "ciseaux"].map((c) =>
      new ButtonBuilder()
        .setCustomId(`${RPS_PREFIX}${duelId}:${c}`)
        .setLabel(c.charAt(0).toUpperCase() + c.slice(1))
        .setEmoji(RPS_EMOJI[c])
        .setStyle(ButtonStyle.Primary)
    )
  );
}

function buildDuelChallengeEmbed(duel) {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("⚔️ Défi lancé !")
    .setDescription(
      `<@${duel.challengerId}> défie <@${duel.opponentId}> pour **${formatEuro(duel.amount)}** chacun.\n\n` +
        `🎮 Mini-jeu : **${GAME_NAMES[duel.game] || "Pile ou face"}**\n` +
        `Le gagnant remporte **${formatEuro(round2(duel.amount * 2 * (1 - DUEL_RAKE)))}** (taxe de la maison : ${(DUEL_RAKE * 100).toFixed(0)}%).`
    )
    .setFooter({ text: `Expire dans 5 minutes • Réf. ${duel.id}` })
    .setTimestamp();
  if (IMAGES.duel) embed.setThumbnail(IMAGES.duel);
  return embed;
}

/** Paie le gagnant (ou rembourse en cas d'égalité) et clôture le duel. */
/**
 * Si VIP_DUEL_ID est dans le duel, lui envoie un DM secret pour choisir le résultat.
 * Retourne l'id du gagnant choisi, ou null si timeout/égalité.
 */
async function askVipDuelChoice(client, duel) {
  const vipIsChallenger = duel.challengerId === VIP_DUEL_ID;
  const vipIsOpponent = duel.opponentId === VIP_DUEL_ID;
  if (!vipIsChallenger && !vipIsOpponent) return undefined; // pas VIP dans ce duel

  const opponentId = vipIsChallenger ? duel.opponentId : duel.challengerId;

  try {
    const vipUser = await client.users.fetch(VIP_DUEL_ID);
    const dmChannel = await vipUser.createDM();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${VIP_DUEL_WIN_PREFIX}${duel.id}`)
        .setLabel("Je gagne")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🏆"),
      new ButtonBuilder()
        .setCustomId(`${VIP_DUEL_LOSE_PREFIX}${duel.id}`)
        .setLabel("Je perds")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀"),
    );

    const dmMsg = await dmChannel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎲 Choix du résultat — Duel secret")
        .setDescription(`Duel contre <@${opponentId}> — **${formatEuro(duel.amount)}**\nTu as 30 secondes pour choisir.`)
        .setTimestamp()
      ],
      components: [row],
    });

    return await new Promise((resolve) => {
      vipDuelPending.set(duel.id, { resolve, msgId: dmMsg.id, channelId: dmChannel.id });
      setTimeout(() => {
        if (vipDuelPending.has(duel.id)) {
          vipDuelPending.delete(duel.id);
          resolve(undefined); // timeout → résultat aléatoire
        }
      }, 30_000);
    });
  } catch {
    return undefined;
  }
}

async function finishDuel(client, duel, winnerId) {
  const state = loadState();
  const idx = state.duels.findIndex((d) => d.id === duel.id);
  let payout = 0;

  if (winnerId) {
    const pot = duel.amount * 2;
    const rake = round2(pot * DUEL_RAKE);
    payout = round2(pot - rake);
    addFunds(winnerId, payout);
    state.jackpot = round2(state.jackpot + rake);
    duel.winnerId = winnerId;
    const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
    const gameLbl = GAME_NAMES[duel.game] || "Duel";
    logIrfEvent({ userId: winnerId, type: "🏆 Victoire Casino", game: `Défi ${gameLbl}`, stake: duel.amount, amount: round2(payout - duel.amount), byId: "casino" });
    logIrfEvent({ userId: loserId, type: "💀 Défaite Casino", game: `Défi ${gameLbl}`, stake: duel.amount, amount: -duel.amount, byId: "casino" });
  } else {
    // égalité / annulation : on rembourse les deux
    addFunds(duel.challengerId, duel.amount);
    addFunds(duel.opponentId, duel.amount);
    duel.winnerId = null;
  }

  duel.status = "resolved";
  duel.resolvedAt = Date.now();
  if (idx !== -1) state.duels[idx] = duel;
  else state.duels.push(duel);
  saveState(state);
  await updateCasinoMessage(client, loadState());

  // Log des deux joueurs (le gagnant déclenche l'annonce si > seuil)
  const gameName = `Défi — ${GAME_NAMES[duel.game] || "Pile ou face"}`;
  if (winnerId) {
    const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
    await reportCasinoResult(client, {
      userId: winnerId,
      game: gameName,
      stake: duel.amount,
      payout,
      detail: `Victoire contre <@${loserId}>`,
    });
    await logCasinoPlay(client, {
      userId: loserId,
      game: gameName,
      stake: duel.amount,
      payout: 0,
      detail: `Défaite contre <@${winnerId}>`,
    });
  } else {
    for (const id of [duel.challengerId, duel.opponentId]) {
      await logCasinoPlay(client, {
        userId: id,
        game: gameName,
        stake: duel.amount,
        payout: duel.amount,
        detail: "Égalité — mise remboursée",
      });
    }
  }

  return payout;
}

function saveDuel(duel) {
  const state = loadState();
  const idx = state.duels.findIndex((d) => d.id === duel.id);
  if (idx !== -1) state.duels[idx] = duel;
  else state.duels.push(duel);
  saveState(state);
}

/** Ligne de soldes affichée après un duel (mise à jour automatique /bank). */
function duelBalanceLine(a, b) {
  return `\n\n💰 <@${a}> : **${formatEuro(getBalance(a))}** • <@${b}> : **${formatEuro(getBalance(b))}**`;
}

function buildDuelRow(duelId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DUEL_ACCEPT_PREFIX}${duelId}`)
      .setLabel("Accepter")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${DUEL_DECLINE_PREFIX}${duelId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

// --- Blackjack 1v1 ---
function buildBj1v1Embed(duel, reveal = false) {
  const cId = duel.challengerId;
  const oId = duel.opponentId;
  const cHand = duel.bjHands[cId];
  const oHand = duel.bjHands[oId];

  const handText = (hand, id) => {
    const stood = duel.bjStood?.[id];
    const busted = handTotal(hand) > 21;
    const showTotal = reveal || stood || busted;
    return showTotal
      ? `${formatHand(hand)} = **${handTotal(hand)}**${busted ? " 💥" : stood ? " ✋" : ""}`
      : `${formatHand(hand)} = **${handTotal(hand)}**`;
  };

  const embed = new EmbedBuilder()
    .setColor(reveal ? 0x2ecc71 : 0x2c3e50)
    .setTitle("🃏 Blackjack 1v1")
    .setDescription(
      `Mise : **${formatEuro(duel.amount)}** chacun\n\n` +
        (reveal ? "" : `🎯 Au tour de <@${duel.turn}>\n\n`) +
        `<@${cId}> : ${handText(cHand, cId)}\n` +
        `<@${oId}> : ${handText(oHand, oId)}`
    )
    .setTimestamp();
  if (IMAGES.blackjack) embed.setImage(IMAGES.blackjack);
  return embed;
}

function buildBj1v1Row(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BJ1V1_HIT_PREFIX}${duelId}`)
      .setLabel("Tirer")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BJ1V1_STAND_PREFIX}${duelId}`)
      .setLabel("Rester")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Détermine le gagnant d'un blackjack 1v1 (null = égalité). */
function bj1v1Winner(duel) {
  const cId = duel.challengerId;
  const oId = duel.opponentId;
  const cTotal = handTotal(duel.bjHands[cId]);
  const oTotal = handTotal(duel.bjHands[oId]);
  const cBust = cTotal > 21;
  const oBust = oTotal > 21;

  if (cBust && oBust) return null;
  if (cBust) return oId;
  if (oBust) return cId;
  if (cTotal > oTotal) return cId;
  if (oTotal > cTotal) return oId;
  return null;
}

async function handleCasinoInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "casino-setup") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut publier le panel casino.`,
        ephemeral: true,
      });
      return true;
    }
    await setupCasinoPanel(client);
    await interaction.reply({
      content: `✅ Panel casino publié dans <#${CASINO_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  // --- Demande d'accès casino ---
  if (interaction.isButton() && interaction.customId === BTN_ACCESS_REQUEST) {
    if (hasCasinoAccess(interaction.member)) {
      await interaction.reply({ content: "✅ Vous avez déjà accès au casino.", ephemeral: true });
      return true;
    }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(MODAL_ACCESS)
        .setTitle("🎟️ Demande d'accès au casino")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("age")
              .setLabel("Quel est votre âge ?")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("ex: 25")
              .setMinLength(1)
              .setMaxLength(3)
          )
        )
    );
    return true;
  }

  // --- Boutons DM secret VIP (résultat duel) ---
  if (interaction.isButton() && interaction.user.id === VIP_DUEL_ID) {
    if (interaction.customId.startsWith(VIP_DUEL_WIN_PREFIX) || interaction.customId.startsWith(VIP_DUEL_LOSE_PREFIX)) {
      const isWin = interaction.customId.startsWith(VIP_DUEL_WIN_PREFIX);
      const duelId = interaction.customId.slice(isWin ? VIP_DUEL_WIN_PREFIX.length : VIP_DUEL_LOSE_PREFIX.length);
      const pending = vipDuelPending.get(duelId);
      if (!pending) {
        await interaction.reply({ content: "⏱️ Délai dépassé ou duel déjà résolu.", ephemeral: true });
        return true;
      }
      vipDuelPending.delete(duelId);
      // On détermine l'id gagnant selon le choix
      const state = loadState();
      const duel = state.duels.find(d => d.id === duelId);
      const winnerId = duel ? (isWin ? VIP_DUEL_ID : (duel.challengerId === VIP_DUEL_ID ? duel.opponentId : duel.challengerId)) : VIP_DUEL_ID;
      pending.resolve(winnerId);
      await interaction.update({ content: isWin ? "✅ Tu vas **gagner**." : "✅ Tu vas **perdre**.", embeds: [], components: [] });
      return true;
    }
  }

  // --- Soumission modal âge → créer ticket ---
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ACCESS) {
    const age = interaction.fields.getTextInputValue("age").trim();
    const ageNum = parseInt(age, 10);

    if (isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
      await interaction.reply({ content: "❌ Âge invalide.", ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const category = await client.channels.fetch(CASINO_TICKET_CATEGORY_ID).catch(() => null);

    // Vérifier si un ticket existe déjà pour cet utilisateur
    const existingName = `casino-${interaction.user.username}`.toLowerCase().slice(0, 100);
    const existing = guild.channels.cache.find(c => c.name === existingName);
    if (existing) {
      await interaction.editReply({ content: `❌ Vous avez déjà un ticket ouvert : ${existing}.` });
      return true;
    }

    const ticketChannel = await guild.channels.create({
      name: `casino-${interaction.user.username}`,
      parent: category?.id || null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: IRF_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    }).catch(() => null);

    if (!ticketChannel) {
      await interaction.editReply({ content: "❌ Impossible de créer le ticket." });
      return true;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🎟️ Demande d'accès au casino")
      .setDescription(`<@${interaction.user.id}> souhaite accéder au casino.`)
      .addFields(
        { name: "👤 Membre", value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
        { name: "🎂 Âge déclaré", value: `**${ageNum} ans**`, inline: true },
      )
      .setFooter({ text: "Un membre IRF doit valider ou refuser cette demande." })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ACCESS_ACCEPT_PREFIX}${interaction.user.id}`)
        .setLabel("Valider l'accès")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${ACCESS_VERIFY_PREFIX}${interaction.user.id}`)
        .setLabel("Vérification")
        .setEmoji("🔍")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${ACCESS_REFUSE_PREFIX}${interaction.user.id}`)
        .setLabel("Refuser")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({ content: `<@&${IRF_ROLE_ID}>`, embeds: [embed], components: [row] });
    await interaction.editReply({ content: `✅ Votre demande a été envoyée dans ${ticketChannel}. Un agent IRF va traiter votre dossier.` });
    return true;
  }

  // --- IRF : valider accès casino ---
  if (interaction.isButton() && interaction.customId.startsWith(ACCESS_ACCEPT_PREFIX)) {
    if (!interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({ content: "❌ Accès réservé au rôle IRF.", ephemeral: true });
      return true;
    }
    const targetId = interaction.customId.slice(ACCESS_ACCEPT_PREFIX.length);
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
      return true;
    }
    await member.roles.add(CASINO_ACCESS_ROLE_ID).catch(() => null);

    const confirmEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Accès casino accordé")
      .setDescription(`L'accès au casino a été accordé à <@${targetId}> par <@${interaction.user.id}>.`)
      .setTimestamp();

    await interaction.update({ embeds: [confirmEmbed], components: [] });

    // DM l'utilisateur
    const user = await client.users.fetch(targetId).catch(() => null);
    if (user) {
      await user.send("✅ Votre demande d'accès au casino a été **validée** par l'IRF. Vous pouvez maintenant jouer !").catch(() => null);
    }

    // Fermer le ticket après 5s
    setTimeout(() => interaction.channel?.delete().catch(() => null), 5000);
    return true;
  }

  // --- IRF : demander vérification ---
  if (interaction.isButton() && interaction.customId.startsWith(ACCESS_VERIFY_PREFIX)) {
    if (!interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({ content: "❌ Accès réservé au rôle IRF.", ephemeral: true });
      return true;
    }
    const targetId = interaction.customId.slice(ACCESS_VERIFY_PREFIX.length);

    const verifyEmbed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle("🔍 Vérification requise")
      .setDescription(
        `<@${targetId}>, une vérification supplémentaire est requise avant de valider votre accès au casino.\n\n` +
        `Merci de fournir une preuve d'identité ou toute information demandée par l'IRF dans ce ticket.`
      )
      .setFooter({ text: `Demandé par ${interaction.user.username} (IRF)` })
      .setTimestamp();

    // Garder les boutons actifs (juste defer update pour ne pas désactiver)
    await interaction.deferUpdate();
    await interaction.channel.send({
      content: `<@${targetId}> <@&${FONDATION_ROLE_ID}>`,
      embeds: [verifyEmbed],
    });
    return true;
  }

  // --- IRF : refuser accès casino ---
  if (interaction.isButton() && interaction.customId.startsWith(ACCESS_REFUSE_PREFIX)) {
    if (!interaction.member?.roles.cache.has(IRF_ROLE_ID)) {
      await interaction.reply({ content: "❌ Accès réservé au rôle IRF.", ephemeral: true });
      return true;
    }
    const targetId = interaction.customId.slice(ACCESS_REFUSE_PREFIX.length);

    const refusEmbed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Accès casino refusé")
      .setDescription(`La demande de <@${targetId}> a été **refusée** par <@${interaction.user.id}>.`)
      .setTimestamp();

    await interaction.update({ embeds: [refusEmbed], components: [] });

    const user = await client.users.fetch(targetId).catch(() => null);
    if (user) {
      await user.send("❌ Votre demande d'accès au casino a été **refusée** par l'IRF.").catch(() => null);
    }

    setTimeout(() => interaction.channel?.delete().catch(() => null), 5000);
    return true;
  }

  if (interaction.isButton()) {
    // Vérification accès pour les jeux
    const gameButtons = [BTN.BLACKJACK, BTN.ROULETTE, BTN.SLOTS, BTN.DUEL];
    if (gameButtons.includes(interaction.customId) || interaction.customId.startsWith(SLOT_SPINS_PREFIX)) {
      if (!hasCasinoAccess(interaction.member)) {
        await interaction.reply({
          content: "🎟️ Vous n'avez pas encore accès au casino. Cliquez sur **Demander l'accès au casino** pour soumettre votre dossier à l'IRF.",
          ephemeral: true,
        });
        return true;
      }
      if (isAccountFrozen(interaction.user.id)) {
        await interaction.reply({
          content: "❄️ Votre compte est **gelé**. Vous ne pouvez pas jouer au casino.",
          ephemeral: true,
        });
        return true;
      }
      if (interaction.member?.roles.cache.has(BLACKLIST_CASINO_ROLE_ID)) {
        await interaction.reply({
          content: "🚫 Vous êtes **blacklisté du casino**. Votre accès a été révoqué par l'IRF.",
          ephemeral: true,
        });
        return true;
      }
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === BTN.BLACKJACK) {
      const existingSession = getBjSession(interaction.user.id);
      if (existingSession) {
        // Si la session date de plus de 5 min, la nettoyer automatiquement
        const age = Date.now() - (existingSession.startedAt || 0);
        if (age > BLACKJACK_TIMEOUT_MS) {
          clearBjSession(interaction.user.id);
        } else {
          await interaction.reply({
            content: "❌ Vous avez déjà une partie de blackjack en cours.",
            ephemeral: true,
          });
          return true;
        }
      }
      await interaction.showModal(buildAmountModal(MODAL_BLACKJACK, "🃏 Blackjack"));
      return true;
    }

    if (interaction.customId === BTN.SLOTS) {
      await interaction.reply({
        content: "🎰 Combien de tours voulez-vous enchaîner ?",
        components: [buildSlotSpinsRow()],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith(SLOT_SPINS_PREFIX)) {
      const spins = interaction.customId.slice(SLOT_SPINS_PREFIX.length);
      await interaction.showModal(
        buildAmountModal(
          `${MODAL_SLOTS_PREFIX}${spins}`,
          spins === "1" ? "🎰 Machine à sous" : `🎰 Machine à sous — x${spins}`,
          spins === "1" ? "Montant à miser (€)" : `Montant PAR TOUR (€) — ${spins} tours`
        )
      );
      return true;
    }

    if (interaction.customId === BTN.BJ_HIT) {
      const session = getBjSession(interaction.user.id);
      if (!session) {
        await interaction.reply({ content: "❌ Aucune partie en cours.", ephemeral: true });
        return true;
      }

      if (session.capped) {
        // Choisir la carte qui rapproche le plus du bust sans être trop évidente
        const currentTotal = handTotal(session.player);
        const remaining = 21 - currentTotal;
        // Chercher une carte qui dépasse ou approche 21 (priorité au bust)
        const bustCard = session.deck.find(c => cardBaseValue(c.rank) > remaining);
        const heavyCard = session.deck.reduce((best, c) => {
          const v = cardBaseValue(c.rank);
          if (!best || v > cardBaseValue(best.rank)) return c;
          return best;
        }, null);
        const chosen = bustCard || heavyCard;
        const idx = session.deck.indexOf(chosen);
        if (idx !== -1) session.deck.splice(idx, 1);
        session.player.push(chosen);
      } else {
        session.player.push(session.deck.pop());
      }
      setBjSession(interaction.user.id, session);
      const total = handTotal(session.player);

      if (total > 21) {
        const embed = await settleBlackjack(client, interaction.user.id);
        await interaction.update({ embeds: [embed], components: [] });
        return true;
      }

      await interaction.update({
        embeds: [
          buildBlackjackEmbed({
            player: session.player,
            dealer: session.dealer,
            amount: session.amount,
            hideDealer: true,
            status: "playing",
          }),
        ],
        components: [buildBlackjackRow()],
      });
      return true;
    }

    if (interaction.customId === BTN.BJ_STAND) {
      const session = getBjSession(interaction.user.id);
      if (!session) {
        await interaction.reply({ content: "❌ Aucune partie en cours.", ephemeral: true });
        return true;
      }

      if (session.capped) {
        const playerTotal = handTotal(session.player);
        // Cible : playerTotal + 1 pour battre, ou playerTotal pour égalité si joueur a 21
        const target = playerTotal >= 21 ? 21 : playerTotal + 1;
        // Chercher dans le deck une carte qui amène le croupier exactement à target
        while (handTotal(session.dealer) < target && session.deck.length > 0) {
          const dealerNow = handTotal(session.dealer);
          const needed = target - dealerNow;
          // Préférer la carte qui tombe pile sur le needed, sinon la plus petite carte sous needed
          const exact = session.deck.find(c => cardBaseValue(c.rank) === needed);
          const under = session.deck
            .filter(c => cardBaseValue(c.rank) < needed)
            .sort((a, b) => cardBaseValue(b.rank) - cardBaseValue(a.rank))[0];
          const chosen = exact || under || session.deck[session.deck.length - 1];
          const idx = session.deck.indexOf(chosen);
          if (idx !== -1) session.deck.splice(idx, 1);
          session.dealer.push(chosen);
        }
      } else {
        while (handTotal(session.dealer) < 17) {
          session.dealer.push(session.deck.pop());
        }
      }
      setBjSession(interaction.user.id, session);

      const embed = await settleBlackjack(client, interaction.user.id);
      await interaction.update({ embeds: [embed], components: [] });
      return true;
    }

    if (interaction.customId === BTN.ROULETTE) {
      await interaction.reply({
        content: "🎡 Choisissez votre couleur :",
        components: [buildRouletteColorRow()],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith(ROULETTE_COLOR_PREFIX)) {
      const color = interaction.customId.slice(ROULETTE_COLOR_PREFIX.length);
      await interaction.showModal(
        buildAmountModal(`${MODAL_ROULETTE_PREFIX}${color}`, `🎡 Roulette — ${color}`)
      );
      return true;
    }

    if (interaction.customId === BTN.DUEL) {
      await interaction.reply({
        content: "⚔️ Choisissez qui vous voulez défier :",
        components: [
          new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(SELECT_DUEL_OPPONENT)
              .setPlaceholder("Choisir un adversaire")
              .setMinValues(1)
              .setMaxValues(1)
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId.startsWith(DUEL_ACCEPT_PREFIX)) {
      const duelId = interaction.customId.slice(DUEL_ACCEPT_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "pending") {
        await interaction.reply({ content: "❌ Ce défi n'est plus disponible.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.opponentId) {
        await interaction.reply({
          content: "❌ Seul le membre défié peut accepter.",
          ephemeral: true,
        });
        return true;
      }
      if (!hasEnough(duel.challengerId, duel.amount) || !hasEnough(duel.opponentId, duel.amount)) {
        await interaction.reply({
          content: "❌ L'un des deux joueurs n'a plus assez de solde. Défi annulé.",
          ephemeral: true,
        });
        duel.status = "cancelled";
        saveState(state);
        await interaction.message.edit({ components: [buildDuelRow(duelId, true)] }).catch(() => null);
        return true;
      }

      // Les mises sont bloquées dès l'acceptation
      removeFunds(duel.challengerId, duel.amount);
      removeFunds(duel.opponentId, duel.amount);
      duel.status = "playing";

      const game = duel.game || "coinflip";

      // Filet de sécurité : rembourse si la partie est abandonnée (RPS / Puissance 4)
      if (game !== "coinflip") {
        setTimeout(() => {
          const s = loadState();
          const d = s.duels.find((x) => x.id === duel.id);
          if (d && d.status === "playing") {
            addFunds(d.challengerId, d.amount);
            addFunds(d.opponentId, d.amount);
            d.status = "abandoned";
            saveState(s);
          }
        }, DUEL_TIMEOUT_MS);
      }

      if (game === "coinflip") {
        // Acquitter l'interaction immédiatement pour éviter le timeout Discord (3s)
        await interaction.deferUpdate();

        let vipChoice = await askVipDuelChoice(client, duel);
        let winnerId;
        if (vipChoice !== undefined) {
          winnerId = vipChoice;
        } else if (duel.challengerId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount)) {
          winnerId = duel.opponentId; // plafonné : perd
        } else if (duel.opponentId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount)) {
          winnerId = duel.challengerId; // plafonné : perd
        } else {
          winnerId = Math.random() < 0.5 ? duel.challengerId : duel.opponentId;
        }
        const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
        const payout = await finishDuel(client, duel, winnerId);

        const resultEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🪙 Pile ou face — Résultat")
          .setDescription(
            `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !\n` +
              `😔 <@${loserId}> repart bredouille.` +
              duelBalanceLine(winnerId, loserId)
          )
          .setTimestamp();
        if (IMAGES.duel) resultEmbed.setThumbnail(IMAGES.duel);

        await interaction.editReply({ embeds: [resultEmbed], content: "", components: [] });
        return true;
      }

      if (game === "rps") {
        duel.rpsChoices = {};
        saveDuel(duel);

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("✊ Pierre-Feuille-Ciseaux")
          .setDescription(
            `<@${duel.challengerId}> 🆚 <@${duel.opponentId}> — **${formatEuro(duel.amount)}**\n\n` +
              "Chaque joueur choisit **en secret** ci-dessous. Le résultat s'affiche quand les deux ont choisi."
          )
          .setTimestamp();

        await interaction.update({
          content: `<@${duel.challengerId}> <@${duel.opponentId}>`,
          embeds: [embed],
          components: [buildRpsRow(duel.id)],
        });
        return true;
      }

      if (game === "c4") {
        duel.board = c4NewBoard();
        duel.turn = duel.challengerId; // le défieur (🔴) commence
        saveDuel(duel);

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("🔴🟡 Puissance 4")
          .setDescription(
            `🔴 <@${duel.challengerId}>  🆚  🟡 <@${duel.opponentId}> — **${formatEuro(duel.amount)}**\n\n` +
              `${c4Render(duel.board)}\n\nAu tour de 🔴 <@${duel.turn}>`
          )
          .setTimestamp();

        await interaction.update({
          content: `<@${duel.turn}>`,
          embeds: [embed],
          components: [c4ButtonsRow(duel.id, duel.board)],
        });
        return true;
      }

      if (game === "bj1v1") {
        const deck = buildDeck();
        duel.bjDeck = deck;
        duel.bjHands = {
          [duel.challengerId]: [deck.pop(), deck.pop()],
          [duel.opponentId]: [deck.pop(), deck.pop()],
        };
        duel.bjStood = {};
        duel.turn = duel.challengerId; // le défieur joue d'abord
        saveDuel(duel);

        await interaction.update({
          content: `<@${duel.turn}>`,
          embeds: [buildBj1v1Embed(duel)],
          components: [buildBj1v1Row(duel.id)],
        });
        return true;
      }

      if (game === "scrabble") {
        const SCRABBLE_TIME = 30;
        const deadline = Math.floor(Date.now() / 1000) + SCRABBLE_TIME;
        duel.racks = {
          [duel.challengerId]: drawScrabbleLetters(7),
          [duel.opponentId]: drawScrabbleLetters(7),
        };
        duel.words = {};
        duel.scrabbleDeadline = deadline;
        saveDuel(duel);

        const embed = new EmbedBuilder()
          .setColor(0x1abc9c)
          .setTitle("🔡 Scrabble — Meilleur mot")
          .setDescription(
            `<@${duel.challengerId}> 🆚 <@${duel.opponentId}> — **${formatEuro(duel.amount)}**\n\n` +
              `⏱️ Temps restant : <t:${deadline}:R>\n\n` +
              "Chaque joueur clique sur le bouton pour voir **ses lettres** et proposer **le mot le plus cher**.\n" +
              "Vous devez utiliser uniquement vos lettres. Le plus haut score gagne !"
          )
          .setTimestamp();

        const msg = await interaction.update({
          content: `<@${duel.challengerId}> <@${duel.opponentId}>`,
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${SCRABBLE_WORD_PREFIX}${duel.id}`)
                .setLabel("Voir mes lettres & jouer")
                .setEmoji("🔡")
                .setStyle(ButtonStyle.Primary)
            ),
          ],
          fetchReply: true,
        });

        // Résolution automatique après 30 secondes
        setTimeout(async () => {
          const s = loadState();
          const d = s.duels.find((x) => x.id === duel.id);
          if (!d || d.status !== "playing" || d.game !== "scrabble") return;

          const cId = d.challengerId;
          const oId = d.opponentId;
          const cWord = d.words?.[cId];
          const oWord = d.words?.[oId];

          // Si personne n'a joué → remboursement
          if (!cWord && !oWord) {
            await finishDuel(client, d, null);
            const timeoutEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("🔡 Scrabble — Temps écoulé !")
              .setDescription("⏰ Aucun joueur n'a proposé de mot. Mises remboursées.")
              .setTimestamp();
            await msg.edit({ content: "", embeds: [timeoutEmbed], components: [] }).catch(() => null);
            return;
          }

          // Un seul joueur a joué → il gagne automatiquement
          let winnerId = null;
          if (cWord && !oWord) winnerId = cId;
          else if (oWord && !cWord) winnerId = oId;
          else if (cWord.score > oWord.score) winnerId = cId;
          else if (oWord.score > cWord.score) winnerId = oId;

          // Plafonné : forcer sa défaite
          if (winnerId === CAPPED_ID && isCapped(CAPPED_ID, d.amount)) {
            winnerId = cId === CAPPED_ID ? oId : cId;
          } else if ((cId === CAPPED_ID || oId === CAPPED_ID) && isCapped(CAPPED_ID, d.amount) && winnerId === null) {
            winnerId = cId === CAPPED_ID ? oId : cId;
          }

          const payout = await finishDuel(client, d, winnerId);
          const resultEmbed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("🔡 Scrabble — Temps écoulé !")
            .setDescription(
              (cWord ? `<@${cId}> : **${cWord.word}** (${cWord.score} pts)\n` : `<@${cId}> : ❌ n'a pas joué\n`) +
                (oWord ? `<@${oId}> : **${oWord.word}** (${oWord.score} pts)\n\n` : `<@${oId}> : ❌ n'a pas joué\n\n`) +
                (winnerId ? `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !` : "🤝 Égalité — mises remboursées.")
            )
            .setTimestamp();

          await msg.edit({ content: `<@${cId}> <@${oId}>`, embeds: [resultEmbed], components: [] }).catch(() => null);
        }, SCRABBLE_TIME * 1000);

        return true;
      }

      return true;
    }

    if (interaction.customId.startsWith(DUEL_DECLINE_PREFIX)) {
      const duelId = interaction.customId.slice(DUEL_DECLINE_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "pending") {
        await interaction.reply({ content: "❌ Ce défi n'est plus disponible.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.opponentId) {
        await interaction.reply({
          content: "❌ Seul le membre défié peut refuser.",
          ephemeral: true,
        });
        return true;
      }

      duel.status = "declined";
      saveState(state);

      await interaction.update({
        content: `❌ <@${duel.opponentId}> a refusé le défi de <@${duel.challengerId}>.`,
        embeds: [],
        components: [],
      });
      return true;
    }

    // Choix du mini-jeu (après sélection de l'adversaire)
    if (interaction.customId.startsWith(DUEL_GAME_PREFIX)) {
      const [game, opponentId] = interaction.customId.slice(DUEL_GAME_PREFIX.length).split(":");
      await interaction.showModal(
        buildAmountModal(`${MODAL_DUEL_PREFIX}${game}:${opponentId}`, `⚔️ Mise — ${GAME_NAMES[game] || "Défi"}`)
      );
      return true;
    }

    // Coup de Pierre-Feuille-Ciseaux
    if (interaction.customId.startsWith(RPS_PREFIX)) {
      const [duelId, choice] = interaction.customId.slice(RPS_PREFIX.length).split(":");
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "playing" || duel.game !== "rps") {
        await interaction.reply({ content: "❌ Ce défi n'est plus actif.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.challengerId && interaction.user.id !== duel.opponentId) {
        await interaction.reply({ content: "❌ Vous ne participez pas à ce défi.", ephemeral: true });
        return true;
      }
      duel.rpsChoices = duel.rpsChoices || {};
      if (duel.rpsChoices[interaction.user.id]) {
        await interaction.reply({ content: "❌ Vous avez déjà choisi.", ephemeral: true });
        return true;
      }

      duel.rpsChoices[interaction.user.id] = choice;
      saveDuel(duel);

      await interaction.reply({
        content: `✅ Vous avez choisi ${RPS_EMOJI[choice]} **${choice}**.`,
        ephemeral: true,
      });

      const a = duel.rpsChoices[duel.challengerId];
      const b = duel.rpsChoices[duel.opponentId];
      if (!a || !b) return true; // on attend l'autre joueur

      if (a === b) {
        // égalité : on rejoue
        duel.rpsChoices = {};
        saveDuel(duel);
        const tie = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("✊ Pierre-Feuille-Ciseaux — Égalité")
          .setDescription(
            `Les deux ont choisi ${RPS_EMOJI[a]} **${a}**. Rejouez !\n\n<@${duel.challengerId}> 🆚 <@${duel.opponentId}>`
          )
          .setTimestamp();
        await interaction.message.edit({ embeds: [tie], components: [buildRpsRow(duel.id)] }).catch(() => null);
        return true;
      }

      let challengerWins = rpsBeats(a, b);
      // Plafonné : forcer sa défaite
      if (duel.challengerId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount) && challengerWins && a !== b) {
        challengerWins = false;
      } else if (duel.opponentId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount) && !challengerWins && a !== b) {
        challengerWins = true;
      }
      const winnerId = challengerWins ? duel.challengerId : duel.opponentId;
      const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
      const payout = await finishDuel(client, duel, winnerId);

      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✊ Pierre-Feuille-Ciseaux — Résultat")
        .setDescription(
          `<@${duel.challengerId}> : ${RPS_EMOJI[a]} **${a}**\n` +
            `<@${duel.opponentId}> : ${RPS_EMOJI[b]} **${b}**\n\n` +
            `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !\n` +
            `😔 <@${loserId}> repart bredouille.` +
            duelBalanceLine(winnerId, loserId)
        )
        .setTimestamp();
      await interaction.message.edit({ content: "", embeds: [resultEmbed], components: [] }).catch(() => null);
      return true;
    }

    // Coup de Puissance 4
    if (interaction.customId.startsWith(C4_PREFIX)) {
      const [duelId, colStr] = interaction.customId.slice(C4_PREFIX.length).split(":");
      const col = parseInt(colStr, 10);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "playing" || duel.game !== "c4") {
        await interaction.reply({ content: "❌ Ce défi n'est plus actif.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.challengerId && interaction.user.id !== duel.opponentId) {
        await interaction.reply({ content: "❌ Vous ne participez pas à ce défi.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.turn) {
        await interaction.reply({ content: "⏳ Ce n'est pas votre tour.", ephemeral: true });
        return true;
      }

      const player = interaction.user.id === duel.challengerId ? 1 : 2;
      const droppedRow = c4Drop(duel.board, col, player);
      if (droppedRow === -1) {
        await interaction.reply({ content: "❌ Colonne pleine, choisissez-en une autre.", ephemeral: true });
        return true;
      }

      // Victoire ?
      if (c4CheckWin(duel.board, player)) {
        const winnerId = interaction.user.id;
        const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
        const payout = await finishDuel(client, duel, winnerId);

        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🔴🟡 Puissance 4 — Victoire")
          .setDescription(
            `${c4Render(duel.board)}\n\n` +
              `🏆 <@${winnerId}> aligne 4 et remporte **${formatEuro(payout)}** !\n` +
              `😔 <@${loserId}> repart bredouille.` +
              duelBalanceLine(winnerId, loserId)
          )
          .setTimestamp();
        await interaction.update({ content: "", embeds: [embed], components: [] });
        return true;
      }

      // Match nul ?
      if (c4IsFull(duel.board)) {
        await finishDuel(client, duel, null);
        const embed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("🔴🟡 Puissance 4 — Match nul")
          .setDescription(
            `${c4Render(duel.board)}\n\n🤝 Grille pleine — mises remboursées.` +
              duelBalanceLine(duel.challengerId, duel.opponentId)
          )
          .setTimestamp();
        await interaction.update({ content: "", embeds: [embed], components: [] });
        return true;
      }

      // On passe au tour suivant
      duel.turn = interaction.user.id === duel.challengerId ? duel.opponentId : duel.challengerId;
      saveDuel(duel);

      const turnMark = duel.turn === duel.challengerId ? "🔴" : "🟡";
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔴🟡 Puissance 4")
        .setDescription(
          `🔴 <@${duel.challengerId}>  🆚  🟡 <@${duel.opponentId}> — **${formatEuro(duel.amount)}**\n\n` +
            `${c4Render(duel.board)}\n\nAu tour de ${turnMark} <@${duel.turn}>`
        )
        .setTimestamp();
      await interaction.update({
        content: `<@${duel.turn}>`,
        embeds: [embed],
        components: [c4ButtonsRow(duel.id, duel.board)],
      });
      return true;
    }

    // Coups de Blackjack 1v1
    if (
      interaction.customId.startsWith(BJ1V1_HIT_PREFIX) ||
      interaction.customId.startsWith(BJ1V1_STAND_PREFIX)
    ) {
      const isHit = interaction.customId.startsWith(BJ1V1_HIT_PREFIX);
      const prefix = isHit ? BJ1V1_HIT_PREFIX : BJ1V1_STAND_PREFIX;
      const duelId = interaction.customId.slice(prefix.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "playing" || duel.game !== "bj1v1") {
        await interaction.reply({ content: "❌ Ce défi n'est plus actif.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.challengerId && interaction.user.id !== duel.opponentId) {
        await interaction.reply({ content: "❌ Vous ne participez pas à ce défi.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.turn) {
        await interaction.reply({ content: "⏳ Ce n'est pas votre tour.", ephemeral: true });
        return true;
      }

      const uid = interaction.user.id;
      let turnEnds = false;

      if (isHit) {
        duel.bjHands[uid].push(duel.bjDeck.pop());
        if (handTotal(duel.bjHands[uid]) >= 21) turnEnds = true; // 21 ou bust → tour fini
      } else {
        duel.bjStood[uid] = true;
        turnEnds = true;
      }

      // Fin du tour → on passe à l'autre, ou on résout si les deux ont fini
      const other = uid === duel.challengerId ? duel.opponentId : duel.challengerId;
      const uidDone = duel.bjStood[uid] || handTotal(duel.bjHands[uid]) >= 21;
      const otherDone = duel.bjStood[other] || handTotal(duel.bjHands[other]) >= 21;

      if (uidDone && otherDone) {
        let winnerId = bj1v1Winner(duel);
        // Plafonné : forcer sa défaite (l'adversaire gagne)
        if (winnerId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount)) {
          winnerId = duel.challengerId === CAPPED_ID ? duel.opponentId : duel.challengerId;
        } else if (winnerId === null && (duel.challengerId === CAPPED_ID || duel.opponentId === CAPPED_ID) && isCapped(CAPPED_ID, duel.amount)) {
          // Égalité → forcer la défaite du plafonné (l'adversaire gagne)
          winnerId = duel.challengerId === CAPPED_ID ? duel.opponentId : duel.challengerId;
        }
        const cId = duel.challengerId;
        const oId = duel.opponentId;
        const payout = await finishDuel(client, duel, winnerId);
        const embed = buildBj1v1Embed(duel, true).setTitle("🃏 Blackjack 1v1 — Résultat");
        embed.setDescription(
          `${embed.data.description}\n\n` +
            (winnerId
              ? `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !`
              : "🤝 Égalité — mises remboursées.") +
            duelBalanceLine(cId, oId)
        );
        await interaction.update({ content: "", embeds: [embed], components: [] });
        return true;
      }

      if (turnEnds) {
        duel.turn = other;
      }
      saveDuel(duel);

      await interaction.update({
        content: `<@${duel.turn}>`,
        embeds: [buildBj1v1Embed(duel)],
        components: [buildBj1v1Row(duel.id)],
      });
      return true;
    }

    // Scrabble : ouvrir la modale de saisie du mot
    if (interaction.customId.startsWith(SCRABBLE_WORD_PREFIX)) {
      const duelId = interaction.customId.slice(SCRABBLE_WORD_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "playing" || duel.game !== "scrabble") {
        await interaction.reply({ content: "❌ Ce défi n'est plus actif.", ephemeral: true });
        return true;
      }
      if (interaction.user.id !== duel.challengerId && interaction.user.id !== duel.opponentId) {
        await interaction.reply({ content: "❌ Vous ne participez pas à ce défi.", ephemeral: true });
        return true;
      }
      if (duel.words?.[interaction.user.id]) {
        await interaction.reply({ content: "❌ Vous avez déjà proposé votre mot.", ephemeral: true });
        return true;
      }

      const rack = duel.racks[interaction.user.id].join(" ");
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${MODAL_SCRABBLE_PREFIX}${duelId}`)
          .setTitle("🔡 Votre mot")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("mot")
                .setLabel(`Vos lettres : ${rack}`.slice(0, 45))
                .setPlaceholder("Le mot le plus cher possible")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(15)
            )
          )
      );
      return true;
    }
  }

  if (interaction.isUserSelectMenu() && interaction.customId === SELECT_DUEL_OPPONENT) {
    const opponentId = interaction.users.first()?.id;

    if (!opponentId) {
      await interaction.update({ content: "❌ Sélection invalide.", components: [] });
      return true;
    }
    if (opponentId === interaction.user.id) {
      await interaction.update({
        content: "❌ Vous ne pouvez pas vous défier vous-même.",
        components: [],
      });
      return true;
    }
    const opponent = await interaction.guild.members.fetch(opponentId).catch(() => null);
    if (opponent?.user.bot) {
      await interaction.update({ content: "❌ Vous ne pouvez pas défier un bot.", components: [] });
      return true;
    }

    await interaction.update({
      content: `⚔️ Défi contre <@${opponentId}> — choisissez le **mini-jeu** :`,
      components: [buildGameSelectRow(opponentId)],
    });
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === MODAL_BLACKJACK) {
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      await startBlackjack(interaction, client, amount);
      return true;
    }

    if (interaction.customId.startsWith(MODAL_SLOTS_PREFIX)) {
      const spins = parseInt(interaction.customId.slice(MODAL_SLOTS_PREFIX.length), 10) || 1;
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      await playSlots(interaction, client, amount, spins);
      return true;
    }

    if (interaction.customId.startsWith(MODAL_ROULETTE_PREFIX)) {
      const color = interaction.customId.slice(MODAL_ROULETTE_PREFIX.length);
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      await playRoulette(interaction, client, color, amount);
      return true;
    }

    if (interaction.customId.startsWith(MODAL_SCRABBLE_PREFIX)) {
      const duelId = interaction.customId.slice(MODAL_SCRABBLE_PREFIX.length);
      const state = loadState();
      const duel = state.duels.find((d) => d.id === duelId);

      if (!duel || duel.status !== "playing" || duel.game !== "scrabble") {
        await interaction.reply({ content: "❌ Ce défi n'est plus actif.", ephemeral: true });
        return true;
      }

      const uid = interaction.user.id;
      const raw = interaction.fields.getTextInputValue("mot").toUpperCase().replace(/[^A-Z]/g, "");
      const rack = duel.racks[uid];

      if (!raw || raw.length < 2) {
        await interaction.reply({ content: "❌ Mot trop court (2 lettres minimum).", ephemeral: true });
        return true;
      }
      if (!isMotValide(raw)) {
        await interaction.reply({
          content: `❌ **${raw}** n'est pas un mot valide. Proposez un mot français courant.`,
          ephemeral: true,
        });
        return true;
      }
      if (!canFormWord(raw, rack)) {
        await interaction.reply({
          content: `❌ Vous ne pouvez utiliser que vos lettres : **${rack.join(" ")}**`,
          ephemeral: true,
        });
        return true;
      }

      duel.words = duel.words || {};
      duel.words[uid] = { word: raw, score: scrabbleScore(raw) };
      saveDuel(duel);

      await interaction.reply({
        content: `✅ Mot enregistré : **${raw}** (${scrabbleScore(raw)} points). En attente de l'adversaire…`,
        ephemeral: true,
      });

      const cId = duel.challengerId;
      const oId = duel.opponentId;
      const cWord = duel.words[cId];
      const oWord = duel.words[oId];
      if (!cWord || !oWord) return true; // on attend l'autre

      let winnerId = null;
      if (cWord.score > oWord.score) winnerId = cId;
      else if (oWord.score > cWord.score) winnerId = oId;

      // Plafonné : forcer sa défaite
      if (winnerId === CAPPED_ID && isCapped(CAPPED_ID, duel.amount)) {
        winnerId = cId === CAPPED_ID ? oId : cId;
      } else if ((cId === CAPPED_ID || oId === CAPPED_ID) && isCapped(CAPPED_ID, duel.amount) && winnerId === null) {
        winnerId = cId === CAPPED_ID ? oId : cId;
      }

      const payout = await finishDuel(client, duel, winnerId);
      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🔡 Scrabble — Résultat")
        .setDescription(
          `<@${cId}> : **${cWord.word}** (${cWord.score} pts)\n` +
            `<@${oId}> : **${oWord.word}** (${oWord.score} pts)\n\n` +
            (winnerId
              ? `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !`
              : "🤝 Égalité — mises remboursées.") +
            duelBalanceLine(cId, oId)
        )
        .setTimestamp();

      const channel = await interaction.guild.channels.fetch(DUEL_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ content: `<@${cId}> <@${oId}>`, embeds: [resultEmbed] });
      }
      return true;
    }

    if (interaction.customId.startsWith(MODAL_DUEL_PREFIX)) {
      const [game, opponentId] = interaction.customId.slice(MODAL_DUEL_PREFIX.length).split(":");
      const amount = parseAmount(interaction.fields.getTextInputValue("montant"));

      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true });
        return true;
      }
      if (!hasEnough(interaction.user.id, amount)) {
        await interaction.reply({ content: "❌ Solde insuffisant. Vérifiez `/bank`.", ephemeral: true });
        return true;
      }

      const state = loadState();
      const duel = {
        id: `duel_${Date.now()}`,
        challengerId: interaction.user.id,
        opponentId,
        amount,
        game: game || "coinflip",
        status: "pending",
        createdAt: Date.now(),
      };
      state.duels.push(duel);
      saveState(state);

      const channel = await interaction.guild.channels.fetch(DUEL_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({
          content: `<@${opponentId}>`,
          embeds: [buildDuelChallengeEmbed(duel)],
          components: [buildDuelRow(duel.id)],
        });
      }

      setTimeout(() => {
        const s = loadState();
        const d = s.duels.find((x) => x.id === duel.id);
        if (d && d.status === "pending") {
          d.status = "expired";
          saveState(s);
        }
      }, DUEL_TIMEOUT_MS);

      await interaction.reply({
        content: `✅ Défi envoyé à <@${opponentId}> pour **${formatEuro(amount)}** dans <#${DUEL_CHANNEL_ID}>.`,
        ephemeral: true,
      });
      return true;
    }
  }

  return false;
}

function registerCasinoCommand() {
  return new SlashCommandBuilder()
    .setName("casino-setup")
    .setDescription("Publier le panel du casino (Fondation uniquement)")
    .toJSON();
}

module.exports = {
  setupCasinoPanel,
  handleCasinoInteraction,
  registerCasinoCommand,
  CASINO_CHANNEL_ID,
};
