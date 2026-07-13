const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { EmbedBuilder } = require("discord.js");

const LEVEL_CHANNEL_ID = "1510693589070647416";
const LEADERBOARD_CHANNEL_ID = "1510702663535296623";
const LEADERBOARD_TOP = 3;

const INSULT_ROLE_ID = "1510692182099624058";
const INSULT_THRESHOLD = 3;
const INSULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MESSAGE_LEVELS = [
  { count: 100, roleId: "1510692620064788703", label: "Niveau I" },
  { count: 200, roleId: "1510692870137319716", label: "Niveau II" },
  { count: 350, roleId: "1510693083925188658", label: "Niveau III" },
  { count: 1000, roleId: "1510693310002364587", label: "Niveau IV" },
];

const STATE_FILE = path.join(__dirname, "levels-state.json");

const INSULT_PATTERNS = [
  /\bconnard\b/i,
  /\bconnasse\b/i,
  /\bsalope\b/i,
  /\bpute\b/i,
  /\bputain\b/i,
  /\bencul[eé]\b/i,
  /\bfils de pute\b/i,
  /\bftg\b/i,
  /\bntm\b/i,
  /\bntg\b/i,
  /\bnique\b/i,
  /\bt[a]? gueule\b/i,
  /\bferme ta gueule\b/i,
  /\bbouffon\b/i,
  /\bd[eé]bile\b/i,
  /\bidiot\b/i,
  /\bcr[eé]tin\b/i,
  /\bmerde\b/i,
  /\bbatard\b/i,
  /\bb[aâ]tard\b/i,
  /\bfdp\b/i,
  /\bpd\b/i,
  /\btg\b/i,
  /\bclc\b/i,
  /\btrou du cul\b/i,
  /\basshole\b/i,
  /\bfuck\b/i,
  /\bshit\b/i,
  /\bbitch\b/i,
];

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.users) data.users = {};
    if (data.leaderboardMessageId === undefined) data.leaderboardMessageId = null;
    return data;
  } catch {
    return { users: {}, leaderboardMessageId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getUserData(state, userId) {
  if (!state.users[userId]) {
    state.users[userId] = {
      messages: 0,
      insults: [],
      earnedLevels: [],
      insultRoleGiven: false,
    };
  }
  return state.users[userId];
}

function containsInsult(text) {
  if (!text) return false;
  return INSULT_PATTERNS.some((p) => p.test(text));
}

function pruneInsults(insults) {
  const cutoff = Date.now() - INSULT_WINDOW_MS;
  return insults.filter((ts) => ts >= cutoff);
}

function getNextLevel(messages, earnedLevels) {
  for (const level of MESSAGE_LEVELS) {
    if (!earnedLevels.includes(level.count) && messages < level.count) {
      return level;
    }
  }
  return null;
}

function getProgressInfo(messages, earnedLevels) {
  const next = getNextLevel(messages, earnedLevels);
  if (!next) {
    return { percent: 100, next: null, previous: MESSAGE_LEVELS.at(-1)?.count ?? 0 };
  }

  let previous = 0;
  for (const level of MESSAGE_LEVELS) {
    if (level.count < next.count) previous = level.count;
  }

  const range = next.count - previous;
  const progress = messages - previous;
  const percent = Math.min(100, Math.max(0, Math.round((progress / range) * 100)));

  return { percent, next, previous };
}

function buildBlueProgressBar(percent, segments = 14) {
  const filled = Math.round((percent / 100) * segments);
  const empty = segments - filled;
  return `${"🟦".repeat(filled)}${"⬜".repeat(empty)}\n**${percent}%**`;
}

function buildProgressEmbed(member, userData, guild) {
  const earned = userData.earnedLevels || [];
  const next = getNextLevel(userData.messages, earned);
  const progress = getProgressInfo(userData.messages, earned);

  const levelLines = MESSAGE_LEVELS.map((l) => {
    const done = earned.includes(l.count);
    const icon = done ? "✅" : "🔒";
    const role = guild?.roles.cache.get(l.roleId);
    const roleText = role ? `<@&${l.roleId}>` : `**${l.label}**`;
    return `${icon} ${roleText} — ${l.count} messages`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📊 Votre progression")
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setDescription(
      `${member}\n💬 **${userData.messages}** messages envoyés` +
        (next
          ? `\n🎯 Prochain palier : encore **${next.count - userData.messages}** message(s)`
          : "\n🎉 *Tous les paliers sont débloqués !*")
    )
    .addFields(
      {
        name: "📊 Progression",
        value: buildBlueProgressBar(progress.percent),
      },
      { name: "📈 Paliers messages", value: levelLines }
    )
    .setFooter({ text: "Continuez à participer pour monter de niveau !" })
    .setTimestamp();

  return embed;
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function getSortedLeaderboard(state) {
  return Object.entries(state.users)
    .map(([userId, data]) => ({ userId, messages: data.messages || 0 }))
    .filter((e) => e.messages > 0)
    .sort((a, b) => b.messages - a.messages)
    .slice(0, LEADERBOARD_TOP);
}

function buildLeaderboardEmbed(guild, state) {
  const ranked = getSortedLeaderboard(state);

  let body;
  if (!ranked.length) {
    body = "*Aucun message comptabilisé pour le moment.*";
  } else {
    body = ranked
      .map((entry, i) => {
        const medal = RANK_MEDALS[i] ?? `**${i + 1}.**`;
        const member = guild.members.cache.get(entry.userId);
        const name = member ? `${member}` : `<@${entry.userId}>`;
        return `${medal} ${name} — **${entry.messages.toLocaleString("fr-FR")}** message(s)`;
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🏆 Classement — Plus actifs")
    .setDescription(
      "Membres ayant écrit le **plus de messages** sur le serveur.\n\n" + body
    )
    .setFooter({
      text: `Top ${LEADERBOARD_TOP} • Classement hebdomadaire (chaque dimanche)`,
    })
    .setTimestamp();
}

async function sendLeaderboard(guild, client, replacePrevious = false) {
  const channel = await client.channels
    .fetch(LEADERBOARD_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) return false;

  await guild.members.fetch().catch(() => null);

  const state = loadState();
  const embed = buildLeaderboardEmbed(guild, state);

  if (replacePrevious && state.leaderboardMessageId) {
    const old = await channel.messages
      .fetch(state.leaderboardMessageId)
      .catch(() => null);
    if (old) await old.delete().catch(() => null);
  }

  const sent = await channel.send({ embeds: [embed] });
  state.leaderboardMessageId = sent.id;
  saveState(state);

  return true;
}

async function leaderboardExists(channel, client, state) {
  if (state.leaderboardMessageId) {
    const msg = await channel.messages
      .fetch(state.leaderboardMessageId)
      .catch(() => null);
    if (msg) return true;
  }

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return (
    messages?.some(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title === "🏆 Classement — Plus actifs"
    ) ?? false
  );
}

async function ensureLeaderboard(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await client.channels
      .fetch(LEADERBOARD_CHANNEL_ID)
      .catch(() => null);
    if (!channel?.isTextBased()) continue;

    const state = loadState();
    const exists = await leaderboardExists(channel, client, state);

    if (!exists) {
      await sendLeaderboard(guild, client, false);
      console.log(`[${guild.name}] Classement initial publié (aucun tableau détecté)`);
    }
  }
}

async function publishWeeklyLeaderboard(guild, client) {
  const ok = await sendLeaderboard(guild, client, true);
  if (ok) console.log(`[${guild.name}] Classement hebdomadaire publié`);
}

function startLeaderboardScheduler(client) {
  ensureLeaderboard(client).catch((err) =>
    console.error("Classement initial:", err.message)
  );

  cron.schedule(
    "0 9 * * 0",
    () => {
      for (const guild of client.guilds.cache.values()) {
        publishWeeklyLeaderboard(guild, client).catch((err) =>
          console.error("Classement dimanche:", err.message)
        );
      }
    },
    { timezone: "Europe/Paris" }
  );
  console.log("Classement : envoi programmé chaque dimanche à 9h00 (Paris)");
}

async function announceLevelUp(guild, member, level) {
  const channel = await guild.channels.fetch(LEVEL_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎉 Nouveau niveau !")
    .setDescription(
      `${member} vient de passer **${level.label}** !\n\n` +
        `💬 **${level.count} messages** atteints sur le serveur.\n` +
        `Félicitations ! 🦋`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
}

async function tryAssignRole(member, roleId) {
  if (!roleId || member.roles.cache.has(roleId)) return false;
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return false;
  await member.roles.add(role).catch(() => null);
  return true;
}

async function handleLevelMessage(message) {
  if (!message.guild || message.author.bot) return;

  const state = loadState();
  const userData = getUserData(state, message.author.id);
  userData.messages += 1;

  if (containsInsult(message.content)) {
    userData.insults = pruneInsults(userData.insults || []);
    userData.insults.push(Date.now());

    if (
      userData.insults.length >= INSULT_THRESHOLD &&
      !userData.insultRoleGiven
    ) {
      const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      if (member) {
        const added = await tryAssignRole(member, INSULT_ROLE_ID);
        if (added) userData.insultRoleGiven = true;
      }
    }
  }

  for (const level of MESSAGE_LEVELS) {
    if (
      userData.messages >= level.count &&
      !(userData.earnedLevels || []).includes(level.count)
    ) {
      userData.earnedLevels = userData.earnedLevels || [];
      userData.earnedLevels.push(level.count);

      const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      if (member) {
        await tryAssignRole(member, level.roleId);
        await announceLevelUp(message.guild, member, level);
      }
    }
  }

  saveState(state);
}

async function handleLevelCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "niveau") {
    return false;
  }

  if (interaction.channelId !== LEVEL_CHANNEL_ID) {
    await interaction.reply({
      content: `❌ Utilisez cette commande uniquement dans <#${LEVEL_CHANNEL_ID}>.`,
      ephemeral: true,
    });
    return true;
  }

  const state = loadState();
  const userData = getUserData(state, interaction.user.id);

  await interaction.reply({
    embeds: [buildProgressEmbed(interaction.member, userData, interaction.guild)],
  });
  return true;
}

module.exports = {
  handleLevelMessage,
  handleLevelCommand,
  startLeaderboardScheduler,
  LEVEL_CHANNEL_ID,
  LEADERBOARD_CHANNEL_ID,
  MESSAGE_LEVELS,
};
