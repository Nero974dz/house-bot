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
const { hasEnough, removeFunds, addFunds, formatEuro } = require("./bank");

const CASINO_CHANNEL_ID = "1527054335928827954";
const FONDATION_ROLE_ID = "1509974377267990659";

const STATE_FILE = getStatePath("casino-state.json");
const JACKPOT_SEED = 1000;
const BLACKJACK_RAKE = 0.03;
const ROULETTE_RAKE = 0.03;
const DUEL_RAKE = 0.05;
const DUEL_TIMEOUT_MS = 5 * 60 * 1000;
const BLACKJACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Images utilisées dans les embeds. Uploadez une image dans un salon Discord,
 * clic droit > Copier le lien, et collez l'URL ici (laisser null = pas d'image).
 */
const IMAGES = {
  banner: null,
  blackjack: "https://thumbs.dreamstime.com/b/playing-blackjack-table-4506947.jpg",
  rouletteSpin: "https://www.goforquiz.com/wp-content/uploads/2023/10/casino.gif",
  rouletteRouge: "https://media.giphy.com/media/l2SpYSNrKPONySXYY/giphy.gif",
  rouletteNoir: "https://media1.tenor.com/m/A2DlRFtGcmMAAAAC/rulet.gif",
  duel: null,
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠️", "♥️", "♦️", "♣️"];

const BTN = {
  BLACKJACK: "casino_blackjack",
  ROULETTE: "casino_roulette",
  DUEL: "casino_duel",
  BJ_HIT: "casino_bj_hit",
  BJ_STAND: "casino_bj_stand",
};
const ROULETTE_COLOR_PREFIX = "casino_roulette_color_";
const MODAL_BLACKJACK = "casino_modal_blackjack";
const MODAL_ROULETTE_PREFIX = "casino_modal_roulette_";
const MODAL_DUEL_PREFIX = "casino_modal_duel_"; // + game:opponentId
const SELECT_DUEL_OPPONENT = "casino_select_opponent";
const DUEL_GAME_PREFIX = "casino_duelgame_"; // + game:opponentId
const DUEL_ACCEPT_PREFIX = "casino_duel_accept_";
const DUEL_DECLINE_PREFIX = "casino_duel_decline_";
const RPS_PREFIX = "casino_rps_"; // + duelId:choix
const C4_PREFIX = "casino_c4_"; // + duelId:colonne

const GAME_NAMES = {
  coinflip: "Pile ou face",
  rps: "Pierre-Feuille-Ciseaux",
  c4: "Puissance 4",
};

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
        "🃏 **Blackjack** — battez le croupier sans dépasser 21. Blackjack naturel = x2,5 (et une chance de faire tomber le jackpot).\n" +
        "🎡 **Roulette** — Rouge/Noir (x2) ou Vert (x14, avec une chance de jackpot en plus).\n" +
        "⚔️ **Défi** — Misez directement contre un autre membre, le gagnant rafle la mise (moins la taxe de la maison).\n\n" +
        "*Chaque partie de blackjack et de roulette alimente le jackpot progressif.*"
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
        .setCustomId(BTN.DUEL)
        .setLabel("Défier un membre")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
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
  const state = loadState();
  await updateCasinoMessage(client, state);
}

function buildAmountModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("montant")
          .setLabel("Montant à miser (€)")
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
          ? `${formatCard(dealer[0])} 🂠`
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
  let jackpotHit = false;

  if (playerTotal > 21) {
    status = "lose";
    resultLine = `💥 Vous dépassez 21. Perdu (${formatEuro(amount)}).`;
  } else if (isNaturalBJ && dealerTotal === 21) {
    status = "push";
    payout = amount;
    resultLine = `🤝 Égalité (blackjack des deux côtés). Mise remboursée (${formatEuro(amount)}).`;
  } else if (isNaturalBJ) {
    payout = round2(amount * 2.5);
    status = "win";
    resultLine = `🎉 **Blackjack naturel !** Vous gagnez **${formatEuro(payout)}** (x2,5).`;
    if (Math.random() < 0.15) jackpotHit = true;
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

  let state = loadState();
  if (jackpotHit) {
    const won = state.jackpot;
    addFunds(userId, won);
    state.jackpot = JACKPOT_SEED;
    saveState(state);
    resultLine += `\n\n💥🎉 **BONUS JACKPOT !!!** Vous remportez en plus **${formatEuro(won)}** !`;
  }

  clearBjSession(userId);
  await updateCasinoMessage(client, loadState());

  return buildBlackjackEmbed({ player, dealer, amount, hideDealer: false, status, resultLine });
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

  setBjSession(interaction.user.id, { deck, player, dealer, amount });
  scheduleBjTimeout(interaction.user.id, async (userId) => {
    const embed = await settleBlackjack(client, userId);
    await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
  });

  if (handTotal(player) === 21) {
    const embed = await settleBlackjack(client, interaction.user.id);
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  await interaction.editReply({
    embeds: [buildBlackjackEmbed({ player, dealer, amount, hideDealer: true, status: "playing" })],
    components: [buildBlackjackRow()],
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

  const number = Math.floor(Math.random() * 37);
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

  let jackpotHit = false;
  if (color === resultColor) {
    const won = round2(amount * multiplier);
    addFunds(interaction.user.id, won);
    embed.addFields({ name: "Résultat", value: `✅ Gagné ! Vous remportez **${formatEuro(won)}** (x${multiplier}).` });
    if (resultColor === "vert" && Math.random() < 0.2) jackpotHit = true;
  } else {
    embed.addFields({ name: "Résultat", value: `❌ Perdu. Mise : ${formatEuro(amount)}.` });
  }

  if (jackpotHit) {
    const state = loadState();
    const won = state.jackpot;
    addFunds(interaction.user.id, won);
    state.jackpot = JACKPOT_SEED;
    saveState(state);
    embed.addFields({ name: "💥 Bonus", value: `**JACKPOT !** Vous remportez en plus **${formatEuro(won)}** !` });
  }

  await updateCasinoMessage(client, loadState());
  await interaction.editReply({ content: "", embeds: [embed] });
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

  return payout;
}

function saveDuel(duel) {
  const state = loadState();
  const idx = state.duels.findIndex((d) => d.id === duel.id);
  if (idx !== -1) state.duels[idx] = duel;
  else state.duels.push(duel);
  saveState(state);
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

  if (interaction.isButton()) {
    if (interaction.customId === BTN.BLACKJACK) {
      if (getBjSession(interaction.user.id)) {
        await interaction.reply({
          content: "❌ Vous avez déjà une partie de blackjack en cours.",
          ephemeral: true,
        });
        return true;
      }
      await interaction.showModal(buildAmountModal(MODAL_BLACKJACK, "🃏 Blackjack"));
      return true;
    }

    if (interaction.customId === BTN.BJ_HIT) {
      const session = getBjSession(interaction.user.id);
      if (!session) {
        await interaction.reply({ content: "❌ Aucune partie en cours.", ephemeral: true });
        return true;
      }

      session.player.push(session.deck.pop());
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

      while (handTotal(session.dealer) < 17) {
        session.dealer.push(session.deck.pop());
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
        const winnerId = Math.random() < 0.5 ? duel.challengerId : duel.opponentId;
        const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
        const payout = await finishDuel(client, duel, winnerId);

        const resultEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🪙 Pile ou face — Résultat")
          .setDescription(
            `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !\n` +
              `😔 <@${loserId}> repart bredouille.`
          )
          .setTimestamp();
        if (IMAGES.duel) resultEmbed.setThumbnail(IMAGES.duel);

        await interaction.update({ embeds: [resultEmbed], content: "", components: [] });
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

      const challengerWins = rpsBeats(a, b);
      const winnerId = challengerWins ? duel.challengerId : duel.opponentId;
      const loserId = challengerWins ? duel.opponentId : duel.challengerId;
      const payout = await finishDuel(client, duel, winnerId);

      const resultEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✊ Pierre-Feuille-Ciseaux — Résultat")
        .setDescription(
          `<@${duel.challengerId}> : ${RPS_EMOJI[a]} **${a}**\n` +
            `<@${duel.opponentId}> : ${RPS_EMOJI[b]} **${b}**\n\n` +
            `🏆 <@${winnerId}> remporte **${formatEuro(payout)}** !\n` +
            `😔 <@${loserId}> repart bredouille.`
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
              `😔 <@${loserId}> repart bredouille.`
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
          .setDescription(`${c4Render(duel.board)}\n\n🤝 Grille pleine — mises remboursées.`)
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

      const channel = await interaction.guild.channels.fetch(CASINO_CHANNEL_ID).catch(() => null);
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
        content: `✅ Défi envoyé à <@${opponentId}> pour **${formatEuro(amount)}** dans <#${CASINO_CHANNEL_ID}>.`,
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
