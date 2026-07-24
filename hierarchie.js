const { EmbedBuilder } = require("discord.js");

const HIERARCHY_CHANNEL_ID = "1509983829744681101";

/** Du plus haut au plus bas */
const HIERARCHY_ROLES = [
  { id: "1509974377267990659", name: "Fondation" },
  { id: "1509984877120847963", name: "Responsable" },
  { id: "1509979964651343993", name: "Supervision" },
  { id: "1509985135565475850", name: "Gerants" },
  { id: "1509983439968010401", name: "Membre" },
];

let hierarchyMessageId = null;

/** Un membre avec plusieurs rôles hiérarchie n'apparaît que sous le plus haut. */
function getHighestHierarchyRole(member) {
  for (const role of HIERARCHY_ROLES) {
    if (member.roles.cache.has(role.id)) {
      return role;
    }
  }
  return null;
}

function formatMemberList(members) {
  if (!members.length) return "*Aucun membre*";
  return members
    .sort((a, b) => a.user.username.localeCompare(b.user.username))
    .map((m) => `${m}`)
    .join(", ");
}

function buildHierarchyEmbed(guild) {
  const grouped = new Map(HIERARCHY_ROLES.map((r) => [r.id, []]));

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;
    const highest = getHighestHierarchyRole(member);
    if (!highest) continue;
    // Un seul emplacement : le rôle le plus élevé (les autres rôles sont ignorés)
    grouped.get(highest.id).push(member);
  }

  const lines = HIERARCHY_ROLES.map((role) => {
    const members = grouped.get(role.id) || [];
    return `**${role.name}**\n${formatMemberList(members)}`;
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🏛️ Hiérarchie du serveur")
    .setDescription(
      "**Vue simplifiée : rôle le plus haut uniquement**\n\n" + lines.join("\n\n")
    )
    .setFooter({ text: `${dateStr} ${timeStr}` });
}

async function findHierarchyMessage(channel, client) {
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return null;

  return (
    messages.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title === "🏛️ Hiérarchie du serveur"
    ) ?? null
  );
}

async function refreshHierarchy(guild, client) {
  const channel = await client.channels
    .fetch(HIERARCHY_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon hiérarchie ${HIERARCHY_CHANNEL_ID} introuvable`);
    return;
  }

  await guild.members.fetch().catch(() => null);

  const embed = buildHierarchyEmbed(guild);
  const existing =
    hierarchyMessageId &&
    (await channel.messages.fetch(hierarchyMessageId).catch(() => null));

  const msg =
    existing ?? (await findHierarchyMessage(channel, client));

  if (msg) {
    hierarchyMessageId = msg.id;
    await msg.edit({ embeds: [embed], content: null });
  } else {
    const sent = await channel.send({ embeds: [embed] });
    hierarchyMessageId = sent.id;
  }

  console.log(`[${guild.name}] Hiérarchie mise à jour`);
}

function memberHasHierarchyRole(member) {
  return HIERARCHY_ROLES.some((r) => member.roles.cache.has(r.id));
}

module.exports = {
  HIERARCHY_CHANNEL_ID,
  HIERARCHY_ROLES,
  refreshHierarchy,
  memberHasHierarchyRole,
};
