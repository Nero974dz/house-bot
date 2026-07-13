const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");

const CHAMBRES_CHANNEL_ID = "1509983864624386048";
const CHAMBRE_AJOUT_BUTTON_ID = "chambre_ajout";
const CHAMBRE_RETRAIT_BUTTON_ID = "chambre_retrait";
const CHAMBRE_SELECT_ROOM_ID = "chambre_select_room";
const CHAMBRE_SELECT_REMOVE_ROOM_ID = "chambre_select_remove_room";
const CHAMBRE_SELECT_USER_PREFIX = "chambre_select_user:";
const CHAMBRE_REMOVE_USER_PREFIX = "chambre_remove_user:";
const STATE_FILE = path.join(__dirname, "chambres-state.json");

/** Seul ce rôle peut utiliser Ajout et Retrait */
const CHAMBRE_STAFF_ROLE_ID = "1509979964651343993";

const ROOMS = [
  { id: "double1", name: "Chambre double 1", capacity: 2 },
  { id: "double2", name: "Chambre double 2", capacity: 2 },
  { id: "double3", name: "Chambre double 3", capacity: 2 },
  { id: "suite", name: "Suite", capacity: 2 },
  { id: "penthouse", name: "Penthouse", capacity: 2 },
];

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.rooms) data.rooms = {};
    for (const room of ROOMS) {
      if (!Array.isArray(data.rooms[room.id])) data.rooms[room.id] = [];
    }
    return data;
  } catch {
    return {
      messageId: null,
      rooms: Object.fromEntries(ROOMS.map((r) => [r.id, []])),
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getRoom(roomId) {
  return ROOMS.find((r) => r.id === roomId);
}

function removeMemberFromAllRooms(state, userId) {
  for (const room of ROOMS) {
    state.rooms[room.id] = (state.rooms[room.id] || []).filter(
      (id) => id !== userId
    );
  }
}

function canManageChambres(member) {
  return member?.roles.cache.has(CHAMBRE_STAFF_ROLE_ID) ?? false;
}

function denyMessage() {
  return "❌ Seule l'administration peut gérer les chambres.";
}

function formatOccupants(guild, userIds) {
  if (!userIds?.length) return "— **Libre**";
  const mentions = userIds
    .map((id) => {
      const m = guild.members.cache.get(id);
      return m ? `${m}` : `<@${id}>`;
    })
    .join(", ");
  return `— ${mentions}`;
}

function buildChambresEmbed(guild) {
  const state = loadState();
  const totalPlaces = ROOMS.reduce((n, r) => n + r.capacity, 0);
  const occupied = ROOMS.reduce(
    (n, r) => n + (state.rooms[r.id]?.length || 0),
    0
  );

  const lines = ROOMS.map((room, i) => {
    const ids = state.rooms[room.id] || [];
    return `**${i + 1}. ${room.name}**\n${formatOccupants(guild, ids)}`;
  });

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🛏️ Tableau des chambres")
    .setDescription(
      "Répartition des personnes dans la maison et les chambres\n\n" +
        `🏡 **La Maison** (${occupied}/${totalPlaces} places occupées)\n\n` +
        lines.join("\n\n")
    )
    .setFooter({
      text: "Administration : Ajout ou Retrait pour gérer les chambres",
    });
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CHAMBRE_AJOUT_BUTTON_ID)
        .setLabel("Ajout")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(CHAMBRE_RETRAIT_BUTTON_ID)
        .setLabel("Retrait")
        .setEmoji("➖")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildRoomSelectMenu() {
  const state = loadState();
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CHAMBRE_SELECT_ROOM_ID)
      .setPlaceholder("Choisir une chambre")
      .addOptions(
        ROOMS.map((room) => {
          const count = state.rooms[room.id]?.length || 0;
          const libre = room.capacity - count;
          return {
            label: room.name,
            value: room.id,
            description:
              libre > 0
                ? `${libre} place(s) libre(s)`
                : "Complet",
            emoji: libre > 0 ? "🟢" : "🔴",
          };
        })
      )
  );
}

function buildRemoveRoomSelectMenu() {
  const state = loadState();
  const occupiedRooms = ROOMS.filter(
    (room) => (state.rooms[room.id]?.length || 0) > 0
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CHAMBRE_SELECT_REMOVE_ROOM_ID)
      .setPlaceholder("Choisir une chambre")
      .addOptions(
        occupiedRooms.map((room) => ({
          label: room.name,
          value: room.id,
          description: `${state.rooms[room.id].length} occupant(s)`,
        }))
      )
  );
}

function buildRemoveUserSelectMenu(guild, roomId) {
  const state = loadState();
  const ids = state.rooms[roomId] || [];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_REMOVE_USER_PREFIX}${roomId}`)
      .setPlaceholder("Membre à retirer")
      .addOptions(
        ids.map((id) => {
          const m = guild.members.cache.get(id);
          return {
            label: m?.user.username ?? `Utilisateur ${id.slice(-4)}`,
            value: id,
            description: m?.user.tag,
          };
        })
      )
  );
}

function buildUserSelectMenu(roomId) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${CHAMBRE_SELECT_USER_PREFIX}${roomId}`)
      .setPlaceholder("Choisir un membre Discord")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

async function updateChambresPanel(guild, client) {
  const channel = await client.channels
    .fetch(CHAMBRES_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) return;

  await guild.members.fetch().catch(() => null);

  const state = loadState();
  const embed = buildChambresEmbed(guild);
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
        m.embeds[0]?.title === "🛏️ Tableau des chambres"
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

async function setupChambresPanel(client) {
  for (const guild of client.guilds.cache.values()) {
    await updateChambresPanel(guild, client);
  }
  console.log("Tableau des chambres publié");
}

async function handleChambreInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === CHAMBRE_AJOUT_BUTTON_ID) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    await interaction.reply({
      content: "🏠 Sélectionnez la chambre, puis le membre à y assigner.",
      components: [buildRoomSelectMenu()],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === CHAMBRE_RETRAIT_BUTTON_ID) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const state = loadState();
    const hasAnyone = ROOMS.some(
      (room) => (state.rooms[room.id]?.length || 0) > 0
    );

    if (!hasAnyone) {
      await interaction.reply({
        content: "ℹ️ Aucun membre n'est assigné à une chambre pour le moment.",
        ephemeral: true,
      });
      return true;
    }

    await interaction.reply({
      content: "🏠 Sélectionnez la chambre, puis le membre à retirer.",
      components: [buildRemoveRoomSelectMenu()],
      ephemeral: true,
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === CHAMBRE_SELECT_ROOM_ID
  ) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const roomId = interaction.values[0];
    const room = getRoom(roomId);
    if (!room) {
      await interaction.update({ content: "❌ Chambre invalide.", components: [] });
      return true;
    }

    await interaction.update({
      content: `**${room.name}** — choisissez le membre :`,
      components: [buildUserSelectMenu(roomId)],
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === CHAMBRE_SELECT_REMOVE_ROOM_ID
  ) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const roomId = interaction.values[0];
    const room = getRoom(roomId);
    if (!room) {
      await interaction.update({ content: "❌ Chambre invalide.", components: [] });
      return true;
    }

    await interaction.guild.members.fetch().catch(() => null);

    await interaction.update({
      content: `**${room.name}** — membre à retirer :`,
      components: [buildRemoveUserSelectMenu(interaction.guild, roomId)],
    });
    return true;
  }

  if (
    interaction.isUserSelectMenu() &&
    interaction.customId.startsWith(CHAMBRE_SELECT_USER_PREFIX)
  ) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const roomId = interaction.customId.slice(CHAMBRE_SELECT_USER_PREFIX.length);
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

    if (occupants.includes(targetId)) {
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

    removeMemberFromAllRooms(state, targetId);
    occupants.push(targetId);
    state.rooms[room.id] = occupants;
    saveState(state);

    const target = await interaction.guild.members
      .fetch(targetId)
      .catch(() => null);

    await updateChambresPanel(interaction.guild, interaction.client);

    await interaction.update({
      content: `✅ ${target ?? `<@${targetId}>`} a été ajouté à **${room.name}**.`,
      components: [],
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith(CHAMBRE_REMOVE_USER_PREFIX)
  ) {
    if (!canManageChambres(interaction.member)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return true;
    }

    const roomId = interaction.customId.slice(CHAMBRE_REMOVE_USER_PREFIX.length);
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

    if (!occupants.includes(targetId)) {
      await interaction.update({
        content: `ℹ️ Ce membre n'est pas dans **${room.name}**.`,
        components: [],
      });
      return true;
    }

    state.rooms[room.id] = occupants.filter((id) => id !== targetId);
    saveState(state);

    const target = await interaction.guild.members
      .fetch(targetId)
      .catch(() => null);

    await updateChambresPanel(interaction.guild, interaction.client);

    await interaction.update({
      content: `✅ ${target ?? `<@${targetId}>`} a été retiré de **${room.name}**.`,
      components: [],
    });
    return true;
  }

  return false;
}

module.exports = {
  CHAMBRES_CHANNEL_ID,
  setupChambresPanel,
  updateChambresPanel,
  handleChambreInteraction,
};
