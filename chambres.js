const fs = require("fs");
const { getStatePath, persistState } = require("./storage");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");

const CHAMBRES_CHANNEL_ID = "1509983864624386048";
const CHAMBRE_LOG_CHANNEL_ID = "1510687492896981102";
const CHAMBRE_AJOUT_PREFIX = "chambre_ajout:";
const CHAMBRE_RETRAIT_PREFIX = "chambre_retrait:";
const CHAMBRE_SELECT_ROOM_PREFIX = "chambre_select_room:";
const CHAMBRE_SELECT_REMOVE_ROOM_PREFIX = "chambre_select_remove_room:";
const CHAMBRE_SELECT_USER_PREFIX = "chambre_select_user:";
const CHAMBRE_REMOVE_USER_PREFIX = "chambre_remove_user:";
const STATE_FILE = getStatePath("chambres-state.json");

/** Seul ce rôle peut utiliser Ajout et Retrait */
const CHAMBRE_STAFF_ROLE_ID = "1509979964651343993";

const HOUSES = {
  maison1: {
    id: "maison1",
    name: "Maison 1",
    color: 0x57f287,
    rooms: [
      { id: "m1_double1", name: "Chambre double 1", capacity: 3 },
      { id: "m1_double2", name: "Chambre double 2", capacity: 3 },
      { id: "m1_double3", name: "Chambre double 3", capacity: 3 },
      { id: "m1_suite", name: "Suite", capacity: 3 },
      { id: "m1_penthouse", name: "Penthouse", capacity: 3 },
    ],
  },
  maison2: {
    id: "maison2",
    name: "Maison 2",
    color: 0x5865f2,
    rooms: [
      { id: "m2_penthouse1", name: "Penthouse 1", capacity: 3 },
      { id: "m2_penthouse2", name: "Penthouse 2", capacity: 3 },
      { id: "m2_penthouse3", name: "Penthouse 3", capacity: 3 },
      { id: "m2_penthouse4", name: "Penthouse 4", capacity: 3 },
      { id: "m2_suite1", name: "Suite indépendante 1", capacity: 3 },
      { id: "m2_suite2", name: "Suite indépendante 2", capacity: 3 },
      { id: "m2_classique1", name: "Chambre Classique 1", capacity: 3 },
      { id: "m2_classique2", name: "Chambre Classique 2", capacity: 3 },
      { id: "m2_classique3", name: "Chambre Classique 3", capacity: 3 },
    ],
  },
};

const ALL_ROOMS = Object.values(HOUSES).flatMap((house) =>
  house.rooms.map((room) => ({ ...room, houseId: house.id }))
);

const LEGACY_ROOM_IDS = {
  double1: "m1_double1",
  double2: "m1_double2",
  double3: "m1_double3",
  suite: "m1_suite",
  penthouse: "m1_penthouse",
};

function emptyRoomsState() {
  return Object.fromEntries(ALL_ROOMS.map((room) => [room.id, []]));
}

function migrateState(raw) {
  const state = {
    messageIds: { maison1: null, maison2: null },
    rooms: emptyRoomsState(),
  };

  if (!raw || typeof raw !== "object") return state;

  if (raw.messageIds && typeof raw.messageIds === "object") {
    state.messageIds.maison1 = raw.messageIds.maison1 ?? null;
    state.messageIds.maison2 = raw.messageIds.maison2 ?? null;
  } else if (raw.messageId) {
    state.messageIds.maison1 = raw.messageId;
  }

  const sourceRooms = raw.rooms && typeof raw.rooms === "object" ? raw.rooms : {};
  for (const [roomId, occupants] of Object.entries(sourceRooms)) {
    const targetId = LEGACY_ROOM_IDS[roomId] ?? roomId;
    if (state.rooms[targetId] !== undefined && Array.isArray(occupants)) {
      // Migration : anciens formats (string id) → {id, name}
      state.rooms[targetId] = occupants.map((o) =>
        typeof o === "string" ? { id: o, name: null } : o
      );
    }
  }

  return state;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return migrateState(data);
  } catch {
    return migrateState(null);
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("chambres-state.json");
}

function getHouse(houseId) {
  return HOUSES[houseId] ?? null;
}

function getRoom(roomId) {
  return ALL_ROOMS.find((room) => room.id === roomId) ?? null;
}

function removeMemberFromAllRooms(state, userId) {
  for (const room of ALL_ROOMS) {
    state.rooms[room.id] = (state.rooms[room.id] || []).filter(
      (o) => (typeof o === "string" ? o : o.id) !== userId
    );
  }
}

function canManageChambres(member) {
  return member?.roles.cache.has(CHAMBRE_STAFF_ROLE_ID) ?? false;
}

function denyMessage() {
  return "❌ Seule l'administration peut gérer les chambres.";
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function buildChambreLogEmbed(action, { staff, target, targetId, house, room }) {
  const targetValue = target
    ? `${target} (\`${target.user.tag}\`)`
    : `<@${targetId}>`;

  return new EmbedBuilder()
    .setColor(action === "add" ? 0x57f287 : 0xed4245)
    .setTitle(
      action === "add"
        ? "➕ Membre assigné à une chambre"
        : "➖ Membre retiré d'une chambre"
    )
    .addFields(
      { name: "Membre", value: targetValue, inline: true },
      { name: "Maison", value: house.name, inline: true },
      { name: "Chambre", value: room.name, inline: true },
      {
        name: "Effectué par",
        value: `${staff} (\`${staff.user.tag}\`)`,
        inline: true,
      },
      { name: "Date", value: formatDateTime(Date.now()), inline: true }
    )
    .setTimestamp();
}

async function sendChambreLog(client, embed) {
  const channel = await client.channels.fetch(CHAMBRE_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon logs chambres ${CHAMBRE_LOG_CHANNEL_ID} introuvable`);
    return;
  }
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function formatOccupants(guild, occupants) {
  if (!occupants?.length) return "— **Libre**";
  const names = occupants.map((o) => {
    const id = typeof o === "string" ? o : o.id;
    const savedName = typeof o === "object" ? o.name : null;
    const m = guild.members.cache.get(id);
    if (m) return m.displayName;
    return savedName ?? `*(membre parti)*`;
  });
  return `— ${names.join(", ")}`;
}

function buildHouseEmbed(guild, house) {
  const state = loadState();
  const rooms = house.rooms;
  const totalPlaces = rooms.reduce((n, room) => n + room.capacity, 0);
  const occupied = rooms.reduce(
    (n, room) => n + (state.rooms[room.id]?.length || 0),
    0
  );

  const lines = rooms.map((room, index) => {
    const ids = state.rooms[room.id] || [];
    return `**${index + 1}. ${room.name}**\n${formatOccupants(guild, ids)}`;
  });

  return new EmbedBuilder()
    .setColor(house.color)
    .setTitle(`🛏️ Tableau des chambres — ${house.name}`)
    .setDescription(
      `Répartition des personnes dans **${house.name}**\n\n` +
        `🏡 **${house.name}** (${occupied}/${totalPlaces} places occupées)\n\n` +
        lines.join("\n\n")
    )
    .setFooter({
      text: "Administration : Ajout ou Retrait pour gérer les chambres",
    });
}

function buildPanelComponents(houseId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CHAMBRE_AJOUT_PREFIX}${houseId}`)
        .setLabel("Ajout")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CHAMBRE_RETRAIT_PREFIX}${houseId}`)
        .setLabel("Retrait")
        .setEmoji("➖")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildRoomSelectMenu(houseId) {
  const house = getHouse(houseId);
  const state = loadState();

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_SELECT_ROOM_PREFIX}${houseId}`)
      .setPlaceholder(`Choisir une chambre (${house.name})`)
      .addOptions(
        house.rooms.map((room) => {
          const count = state.rooms[room.id]?.length || 0;
          const libre = room.capacity - count;
          return {
            label: room.name,
            value: room.id,
            description: libre > 0 ? `${libre} place(s) libre(s)` : "Complet",
            emoji: libre > 0 ? "🟢" : "🔴",
          };
        })
      )
  );
}

function buildRemoveRoomSelectMenu(houseId) {
  const house = getHouse(houseId);
  const state = loadState();
  const occupiedRooms = house.rooms.filter(
    (room) => (state.rooms[room.id]?.length || 0) > 0
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_SELECT_REMOVE_ROOM_PREFIX}${houseId}`)
      .setPlaceholder(`Choisir une chambre (${house.name})`)
      .addOptions(
        occupiedRooms.map((room) => ({
          label: room.name,
          value: room.id,
          description: `${state.rooms[room.id].length} occupant(s)`,
        }))
      )
  );
}

function buildRemoveUserSelectMenu(guild, houseId, roomId) {
  const state = loadState();
  const occupants = state.rooms[roomId] || [];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_REMOVE_USER_PREFIX}${houseId}:${roomId}`)
      .setPlaceholder("Membre à retirer")
      .addOptions(
        occupants.map((o) => {
          const id = typeof o === "string" ? o : o.id;
          const savedName = typeof o === "object" ? o.name : null;
          const m = guild.members.cache.get(id);
          const label = m?.displayName ?? savedName ?? `Utilisateur ${id.slice(-4)}`;
          return {
            label: label.slice(0, 100),
            value: id,
            description: m?.user.tag,
          };
        })
      )
  );
}

function buildUserSelectMenu(houseId, roomId) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_SELECT_USER_PREFIX}${houseId}:${roomId}`)
      .setPlaceholder("Choisir un membre Discord")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function parseHousePrefixedId(prefix, customId) {
  if (!customId.startsWith(prefix)) return null;
  const rest = customId.slice(prefix.length);
  const houseId = rest.split(":")[0];
  return getHouse(houseId) ? houseId : null;
}

function parseHouseRoomPrefixedId(prefix, customId) {
  if (!customId.startsWith(prefix)) return null;
  const rest = customId.slice(prefix.length);
  const [houseId, roomId] = rest.split(":");
  if (!getHouse(houseId) || !getRoom(roomId)) return null;
  return { houseId, roomId };
}

async function updateHousePanel(guild, client, houseId) {
  const house = getHouse(houseId);
  if (!house) return;

  const channel = await client.channels
    .fetch(CHAMBRES_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) return;

  await guild.members.fetch().catch(() => null);

  const state = loadState();
  const embed = buildHouseEmbed(guild, house);
  const components = buildPanelComponents(houseId);
  const panelTitle = embed.data.title;

  let msg = null;
  const savedMessageId = state.messageIds[houseId];
  if (savedMessageId) {
    msg = await channel.messages.fetch(savedMessageId).catch(() => null);
  }

  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const candidates = messages?.filter(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title === panelTitle
    );
    if (candidates?.size > 0) {
      // Garder le plus récent, supprimer les doublons
      const sorted = [...candidates.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      msg = sorted[0];
      for (const dup of sorted.slice(1)) {
        await dup.delete().catch(() => null);
      }
    }
  }

  if (msg) {
    await msg.edit({ embeds: [embed], components });
    state.messageIds[houseId] = msg.id;
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    state.messageIds[houseId] = sent.id;
  }

  saveState(state);
}

async function updateChambresPanel(guild, client) {
  for (const houseId of Object.keys(HOUSES)) {
    await updateHousePanel(guild, client, houseId);
  }
}

async function setupChambresPanel(client) {
  for (const guild of client.guilds.cache.values()) {
    await updateChambresPanel(guild, client);
  }
  console.log("Tableaux des chambres (Maison 1 & Maison 2) publiés");
}

async function handleChambreInteraction(interaction) {
  if (interaction.isButton()) {
    const ajoutHouseId = parseHousePrefixedId(
      CHAMBRE_AJOUT_PREFIX,
      interaction.customId
    );
    if (ajoutHouseId) {
      if (!canManageChambres(interaction.member)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return true;
      }

      const house = getHouse(ajoutHouseId);
      await interaction.reply({
        content: `🏠 **${house.name}** — sélectionnez la chambre, puis le membre à y assigner.`,
        components: [buildRoomSelectMenu(ajoutHouseId)],
        ephemeral: true,
      });
      return true;
    }

    const retraitHouseId = parseHousePrefixedId(
      CHAMBRE_RETRAIT_PREFIX,
      interaction.customId
    );
    if (retraitHouseId) {
      if (!canManageChambres(interaction.member)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return true;
      }

      const house = getHouse(retraitHouseId);
      const state = loadState();
      const hasAnyone = house.rooms.some(
        (room) => (state.rooms[room.id]?.length || 0) > 0
      );

      if (!hasAnyone) {
        await interaction.reply({
          content: `ℹ️ Aucun membre n'est assigné à une chambre de **${house.name}** pour le moment.`,
          ephemeral: true,
        });
        return true;
      }

      await interaction.reply({
        content: `🏠 **${house.name}** — sélectionnez la chambre, puis le membre à retirer.`,
        components: [buildRemoveRoomSelectMenu(retraitHouseId)],
        ephemeral: true,
      });
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    const addHouseId = parseHousePrefixedId(
      CHAMBRE_SELECT_ROOM_PREFIX,
      interaction.customId
    );
    if (addHouseId) {
      if (!canManageChambres(interaction.member)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return true;
      }

      const roomId = interaction.values[0];
      const room = getRoom(roomId);
      if (!room || room.houseId !== addHouseId) {
        await interaction.update({
          content: "❌ Chambre invalide.",
          components: [],
        });
        return true;
      }

      await interaction.update({
        content: `**${room.name}** — choisissez le membre :`,
        components: [buildUserSelectMenu(addHouseId, roomId)],
      });
      return true;
    }

    const removeHouseId = parseHousePrefixedId(
      CHAMBRE_SELECT_REMOVE_ROOM_PREFIX,
      interaction.customId
    );
    if (removeHouseId) {
      if (!canManageChambres(interaction.member)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return true;
      }

      const roomId = interaction.values[0];
      const room = getRoom(roomId);
      if (!room || room.houseId !== removeHouseId) {
        await interaction.update({
          content: "❌ Chambre invalide.",
          components: [],
        });
        return true;
      }

      await interaction.guild.members.fetch().catch(() => null);

      await interaction.update({
        content: `**${room.name}** — membre à retirer :`,
        components: [
          buildRemoveUserSelectMenu(interaction.guild, removeHouseId, roomId),
        ],
      });
      return true;
    }

    const removeUser = parseHouseRoomPrefixedId(
      CHAMBRE_REMOVE_USER_PREFIX,
      interaction.customId
    );
    if (removeUser) {
      if (!canManageChambres(interaction.member)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return true;
      }

      const { houseId, roomId } = removeUser;
      const room = getRoom(roomId);
      const targetId = interaction.values[0];

      if (!room || !targetId) {
        await interaction.update({
          content: "❌ Sélection invalide.",
          components: [],
        });
        return true;
      }

      const state = loadState();
      const occupants = state.rooms[room.id] || [];

      if (!occupants.some((o) => (typeof o === "string" ? o : o.id) === targetId)) {
        await interaction.update({
          content: `ℹ️ Ce membre n'est pas dans **${room.name}**.`,
          components: [],
        });
        return true;
      }

      state.rooms[room.id] = occupants.filter((o) => (typeof o === "string" ? o : o.id) !== targetId);
      saveState(state);

      const target = await interaction.guild.members
        .fetch(targetId)
        .catch(() => null);

      await updateHousePanel(interaction.guild, interaction.client, houseId);
      await sendChambreLog(
        interaction.client,
        buildChambreLogEmbed("remove", {
          staff: interaction.member,
          target,
          targetId,
          house: getHouse(houseId),
          room,
        })
      );

      await interaction.update({
        content: `✅ ${target ?? `<@${targetId}>`} a été retiré de **${room.name}**.`,
        components: [],
      });
      return true;
    }
  }

  if (
    interaction.isUserSelectMenu() &&
    interaction.customId.startsWith(CHAMBRE_SELECT_USER_PREFIX)
  ) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const parsed = parseHouseRoomPrefixedId(
      CHAMBRE_SELECT_USER_PREFIX,
      interaction.customId
    );
    if (!parsed) return false;

    const { houseId, roomId } = parsed;
    const room = getRoom(roomId);
    const targetId = interaction.users.first()?.id;

    if (!room || !targetId) {
      await interaction.update({
        content: "❌ Sélection invalide.",
        components: [],
      });
      return true;
    }

    const state = loadState();
    const occupants = state.rooms[room.id] || [];

    if (occupants.some((o) => (typeof o === "string" ? o : o.id) === targetId)) {
      await interaction.update({
        content: `ℹ️ Ce membre est déjà dans **${room.name}**.`,
        components: [],
      });
      return true;
    }

    if (occupants.length >= room.capacity) {
      await interaction.update({
        content: `❌ **${room.name}** est complète. Retirez quelqu'un d'abord.`,
        components: [],
      });
      return true;
    }

    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    removeMemberFromAllRooms(state, targetId);
    occupants.push({ id: targetId, name: target?.displayName ?? null });
    state.rooms[room.id] = occupants;
    saveState(state);

    await updateHousePanel(interaction.guild, interaction.client, houseId);
    await sendChambreLog(
      interaction.client,
      buildChambreLogEmbed("add", {
        staff: interaction.member,
        target,
        targetId,
        house: getHouse(houseId),
        room,
      })
    );

    await interaction.update({
      content: `✅ ${target ?? `<@${targetId}>`} a été ajouté à **${room.name}**.`,
      components: [],
    });
    return true;
  }

  return false;
}

module.exports = {
  CHAMBRES_CHANNEL_ID,
  HOUSES,
  setupChambresPanel,
  updateChambresPanel,
  handleChambreInteraction,
};
