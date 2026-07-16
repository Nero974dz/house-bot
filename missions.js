const fs = require("fs");
const { getStatePath, persistState } = require("./storage");
const {
  addFunds,
  applyTax,
  collectTax,
  logTransaction,
  formatEuro: bankFormatEuro,
} = require("./bank");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const MISSION_PANEL_CHANNEL_ID = "1511131616406147172";
const MISSION_TICKET_CATEGORY_ID = "1510693552299184218";
const FONDATION_ROLE_ID = "1509974377267990659";
const MISSION_LOG_CHANNEL_ID = "1510687492896981102";

const STATE_FILE = getStatePath("missions-state.json");

const MODAL_MISSION = "mission_create_modal";
const SELECT_MISSION = "mission_select";
const BTN_REFRESH = "mission_refresh";
const TAKE_PREFIX = "mission_take_";
const FIN_MISSION_PREFIX = "mission_fin_";
const CLOSE_MISSION_PREFIX = "mission_close_";

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.missions)) data.missions = [];
    return data;
  } catch {
    return { messageId: null, missions: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("missions-state.json");
}

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function parseAmount(str) {
  return parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
}

function slugify(text) {
  return (
    (text || "mission")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 24) || "mission"
  );
}

function getOpenMissions(state) {
  return state.missions.filter((m) => m.status === "open");
}

function getMission(state, missionId) {
  return state.missions.find((m) => m.id === missionId);
}

function buildTicketFinishRow(missionId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${FIN_MISSION_PREFIX}${missionId}`)
      .setLabel("Fin de mission")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function buildTicketClosedRow(missionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${FIN_MISSION_PREFIX}${missionId}`)
      .setLabel("Fin de mission")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${CLOSE_MISSION_PREFIX}${missionId}`)
      .setLabel("Fermer le salon")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
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

function buildMissionModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_MISSION)
    .setTitle("📋 Publier une mission")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("titre")
          .setLabel("Titre de la mission")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Quoi faire / consignes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("prix")
          .setLabel("Rémunération (€)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Ex. 150")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("delai")
          .setLabel("Délai / quand (optionnel)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("Ex. avant vendredi")
          .setMaxLength(100)
      )
    );
}

function buildPanelEmbed(state) {
  const open = getOpenMissions(state);
  const preview = open.slice(0, 6);

  let listing =
    preview.length > 0
      ? preview
          .map(
            (m) =>
              `📌 • **${m.title}** — **${m.price}**\n` +
              `   └ *par <@${m.posterId}>*${m.deadline ? ` • ${m.deadline}` : ""}`
          )
          .join("\n\n")
      : "*Aucune mission disponible pour le moment.*";

  if (open.length > 6) {
    listing += `\n\n*… et ${open.length - 6} autre(s) mission(s)*`;
  }

  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("📋 • MISSIONS INTÉRIM — MAISON • 📋")
    .setDescription(
      "♡ ••••• ♡\n\n" +
        "*Missions ponctuelles publiées par la **Fondation**.*\n" +
        "Consultez une mission, puis **prenez-la** pour ouvrir un ticket avec le donneur.\n\n" +
        `⤷ **${open.length}** mission(s) disponible(s)\n\n` +
        listing
    )
    .setFooter({
      text: "Publier : /mission (Fondation) • Prise = ticket privé",
    })
    .setTimestamp();
}

function buildPanelComponents(state) {
  const rows = [];
  const open = getOpenMissions(state);

  if (open.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SELECT_MISSION)
          .setPlaceholder("📋 Choisir une mission à consulter")
          .addOptions(
            open.slice(0, 25).map((m) => ({
              label: m.title.slice(0, 100),
              value: m.id,
              description: `${m.price}`.slice(0, 100),
              emoji: "📌",
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_REFRESH)
        .setLabel("Actualiser")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return rows;
}

function buildMissionDetailEmbed(mission, guild) {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`📋 ${mission.title}`)
    .setDescription(mission.description)
    .addFields(
      { name: "💶 Rémunération", value: `**${mission.price}**`, inline: true },
      {
        name: "👤 Publié par",
        value: `<@${mission.posterId}>`,
        inline: true,
      }
    )
    .setFooter({ text: `Réf. ${mission.id}` })
    .setTimestamp(new Date(mission.createdAt));

  if (mission.deadline) {
    embed.addFields({
      name: "📅 Quand / délai",
      value: mission.deadline,
      inline: true,
    });
  }

  return embed;
}

function buildTicketIntroEmbed(mission) {
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("📋 Mission — Ticket")
    .setDescription(
      `**${mission.title}**\n\n${mission.description}\n\n` +
        `**Rémunération :** ${mission.price}\n` +
        (mission.deadline ? `**Délai :** ${mission.deadline}\n` : "") +
        `\nCoordonnez-vous ici pour réaliser la mission.`
    )
    .addFields(
      {
        name: "Donneur",
        value: `<@${mission.posterId}>`,
        inline: true,
      },
      {
        name: "Intervenant",
        value: `<@${mission.takerId}>`,
        inline: true,
      }
    )
    .setFooter({ text: `Réf. ${mission.id}` })
    .setTimestamp();
}

function buildMissionTakenLogEmbed(mission, ticketChannel) {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📥 Mission prise")
    .setDescription(`**${mission.title}**`)
    .addFields(
      { name: "👤 Donneur", value: `<@${mission.posterId}>`, inline: true },
      { name: "🙋 Intervenant", value: `<@${mission.takerId}>`, inline: true },
      { name: "💶 Rémunération", value: `${mission.price}`, inline: true },
      { name: "🕒 Prise le", value: formatDateTime(mission.takenAt), inline: true },
      { name: "🎫 Ticket", value: `${ticketChannel}`, inline: true }
    )
    .setFooter({ text: `Réf. ${mission.id}` })
    .setTimestamp(new Date(mission.takenAt));
}

function buildMissionCompletedLogEmbed(mission, ticketChannel, validator) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Mission terminée")
    .setDescription(`**${mission.title}**`)
    .addFields(
      { name: "👤 Donneur", value: `<@${mission.posterId}>`, inline: true },
      { name: "🙋 Intervenant", value: `<@${mission.takerId}>`, inline: true },
      { name: "💶 Rémunération", value: `${mission.price}`, inline: true },
      { name: "🕒 Prise le", value: formatDateTime(mission.takenAt), inline: true },
      { name: "🏁 Terminée le", value: formatDateTime(mission.completedAt), inline: true },
      { name: "✅ Validée par", value: `<@${validator.id}>`, inline: true },
      { name: "🎫 Ticket", value: `${ticketChannel}`, inline: true }
    )
    .setFooter({ text: `Réf. ${mission.id}` })
    .setTimestamp(new Date(mission.completedAt));
}

async function sendMissionLog(guild, embed) {
  const logChannel = await guild.channels.fetch(MISSION_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased()) {
    console.warn(`Salon logs mission ${MISSION_LOG_CHANNEL_ID} introuvable`);
    return;
  }
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

async function updateMissionPanel(client) {
  const channel = await client.channels
    .fetch(MISSION_PANEL_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  const embed = buildPanelEmbed(state);
  const components = buildPanelComponents(state);

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    msg = messages?.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title?.includes("MISSIONS INTÉRIM")
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

async function setupMissionPanel(client) {
  await updateMissionPanel(client);
  console.log("Panel missions publié");
}

async function createMissionTicket(guild, mission) {
  const poster = await guild.members.fetch(mission.posterId).catch(() => null);
  const taker = await guild.members.fetch(mission.takerId).catch(() => null);
  if (!poster || !taker) throw new Error("Membres introuvables");

  const channelName = `mission-${slugify(mission.title)}`.slice(0, 100);

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: mission.posterId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: mission.takerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: MISSION_TICKET_CATEGORY_ID,
    topic: `mission:${mission.id}`,
    permissionOverwrites,
  });

  await ticketChannel.send({
    content: `<@${mission.posterId}> <@${mission.takerId}>`,
    embeds: [buildTicketIntroEmbed(mission)],
    components: [buildTicketFinishRow(mission.id)],
  });

  return ticketChannel;
}

async function finishMission(interaction, client, missionId) {
  const state = loadState();
  const mission = getMission(state, missionId);

  if (!mission || mission.status !== "taken") {
    await interaction.reply({
      content: "❌ Mission introuvable ou déjà clôturée.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== mission.posterId) {
    await interaction.reply({
      content: "❌ Seul le **donneur** de la mission peut déclarer la fin de mission.",
      ephemeral: true,
    });
    return;
  }

  if (mission.completedAt) {
    await interaction.reply({
      content: "ℹ️ Cette mission est déjà marquée comme terminée.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  mission.completedAt = Date.now();
  mission.status = "completed";
  saveState(state);

  await sendMissionLog(
    interaction.guild,
    buildMissionCompletedLogEmbed(mission, interaction.channel, interaction.user)
  );

  const price = parseAmount(mission.price);
  const { gross, tax, net } = applyTax(price);
  addFunds(mission.takerId, net);
  collectTax(tax);

  await logTransaction(client, {
    type: `📋 Mission — ${mission.title}`,
    to: mission.takerId,
    gross,
    tax,
    net,
  });

  const payoutMsg =
    `🏁 **Fin de mission** — **${mission.title}** est terminée.\n\n` +
    `<@${mission.takerId}>, vous avez été payé automatiquement : **${bankFormatEuro(net)}** ` +
    `(rémunération ${bankFormatEuro(gross)} − taxe de la maison ${bankFormatEuro(tax)}). Vérifiez avec \`/bank\`.`;

  await interaction.channel.send({ content: payoutMsg });

  const taker = await interaction.guild.members
    .fetch(mission.takerId)
    .catch(() => null);
  if (taker) {
    await taker
      .send(
        `🏁 La mission **${mission.title}** est terminée.\n\n` +
          `Vous avez reçu **${bankFormatEuro(net)}** sur votre compte \`/bank\` ` +
          `(rémunération ${bankFormatEuro(gross)} − taxe ${bankFormatEuro(tax)}).\n` +
          `Ticket : ${interaction.channel}`
      )
      .catch(() => null);
  }

  const introEmbed = buildTicketIntroEmbed(mission)
    .setColor(0x95a5a6)
    .setTitle("✅ Mission terminée");

  await interaction.editReply({
    embeds: [introEmbed],
    components: [buildTicketClosedRow(missionId)],
  });

  await interaction.followUp({
    content: "✅ Fin de mission signalée — l'intervenant a été notifié.",
    ephemeral: true,
  });
}

async function closeMissionTicket(interaction, missionId) {
  const state = loadState();
  const mission = getMission(state, missionId);
  const channel = interaction.channel;

  if (!mission) {
    await interaction.reply({ content: "❌ Mission introuvable.", ephemeral: true });
    return;
  }

  const member = interaction.member;
  const isParticipant =
    member?.id === mission.posterId || member?.id === mission.takerId;
  const isStaff = member?.permissions.has(PermissionFlagsBits.ManageChannels);

  if (!isParticipant && !isStaff) {
    await interaction.reply({
      content: "❌ Seuls le donneur, l'intervenant ou le staff peuvent fermer ce salon.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: "🔒 Fermeture du salon dans 3 secondes…" });

  setTimeout(async () => {
    try {
      await channel.delete("Mission terminée — salon fermé");
    } catch (err) {
      console.error("Erreur fermeture salon mission:", err.message);
    }
  }, 3000);
}

function isMissionInteraction(interaction) {
  const id = interaction.customId ?? "";
  return (
    (interaction.isChatInputCommand() && interaction.commandName === "mission") ||
    (interaction.isModalSubmit() && id === MODAL_MISSION) ||
    id === SELECT_MISSION ||
    id === BTN_REFRESH ||
    id.startsWith(TAKE_PREFIX) ||
    id.startsWith(FIN_MISSION_PREFIX) ||
    id.startsWith(CLOSE_MISSION_PREFIX)
  );
}

function denyFondation(interaction) {
  return interaction.reply({
    content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut publier des missions via \`/mission\`.`,
    ephemeral: true,
  });
}

async function handleMissionInteraction(interaction, client) {
  if (!isMissionInteraction(interaction)) return false;

  if (interaction.isChatInputCommand() && interaction.commandName === "mission") {
    if (!isFondation(interaction.member)) {
      await denyFondation(interaction);
      return true;
    }
    await interaction.showModal(buildMissionModal());
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_MISSION) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: "❌ Permission refusée.",
        ephemeral: true,
      });
      return true;
    }

    const title = interaction.fields.getTextInputValue("titre").trim();
    const description = interaction.fields.getTextInputValue("description").trim();
    const price = interaction.fields.getTextInputValue("prix").trim();
    const deadline =
      interaction.fields.getTextInputValue("delai")?.trim() || null;

    if (!title || !description || !price) {
      await interaction.reply({
        content: "❌ Titre, description et rémunération sont obligatoires.",
        ephemeral: true,
      });
      return true;
    }

    const state = loadState();
    state.missions.push({
      id: `mis_${Date.now()}`,
      posterId: interaction.user.id,
      title,
      description,
      price: price.includes("€") ? price : `${price} €`,
      deadline,
      createdAt: Date.now(),
      status: "open",
      takerId: null,
      ticketChannelId: null,
      takenAt: null,
      completedAt: null,
    });
    saveState(state);
    await updateMissionPanel(client);

    await interaction.reply({
      content:
        `✅ Mission **${title}** publiée sur le panel (<#${MISSION_PANEL_CHANNEL_ID}>).\n` +
        `**Rémunération :** ${state.missions.at(-1).price}`,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === BTN_REFRESH) {
    await updateMissionPanel(client);
    await interaction.reply({
      content: "🔄 Panel missions actualisé.",
      ephemeral: true,
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === SELECT_MISSION
  ) {
    const state = loadState();
    const mission = getMission(state, interaction.values[0]);

    if (!mission || mission.status !== "open") {
      await interaction.reply({
        content: "❌ Cette mission n'est plus disponible.",
        ephemeral: true,
      });
      return true;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${TAKE_PREFIX}${mission.id}`)
        .setLabel("Prendre la mission")
        .setEmoji("✋")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      embeds: [buildMissionDetailEmbed(mission, interaction.guild)],
      components: [row],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(FIN_MISSION_PREFIX)) {
    const missionId = interaction.customId.slice(FIN_MISSION_PREFIX.length);
    await finishMission(interaction, client, missionId);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(CLOSE_MISSION_PREFIX)) {
    const missionId = interaction.customId.slice(CLOSE_MISSION_PREFIX.length);
    await closeMissionTicket(interaction, missionId);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(TAKE_PREFIX)) {
    const missionId = interaction.customId.slice(TAKE_PREFIX.length);
    const state = loadState();
    const mission = getMission(state, missionId);

    if (!mission || mission.status !== "open") {
      await interaction.reply({
        content: "❌ Cette mission n'est plus disponible.",
        ephemeral: true,
      });
      return true;
    }

    if (mission.posterId === interaction.user.id) {
      await interaction.reply({
        content: "❌ Vous ne pouvez pas prendre votre propre mission.",
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferUpdate();

    try {
      mission.status = "taken";
      mission.takerId = interaction.user.id;
      mission.takenAt = Date.now();

      const ticketChannel = await createMissionTicket(
        interaction.guild,
        mission
      );
      mission.ticketChannelId = ticketChannel.id;
      saveState(state);
      await updateMissionPanel(client);
      await sendMissionLog(
        interaction.guild,
        buildMissionTakenLogEmbed(mission, ticketChannel)
      );

      await interaction.editReply({
        content:
          `✅ Mission **${mission.title}** acceptée !\n` +
          `Ticket ouvert : ${ticketChannel}`,
        embeds: [],
        components: [],
      });

      const poster = await interaction.guild.members
        .fetch(mission.posterId)
        .catch(() => null);
      if (poster) {
        await poster
          .send(
            `✋ <@${interaction.user.id}> a pris votre mission **${mission.title}**.\n` +
              `Ticket : ${ticketChannel}`
          )
          .catch(() => null);
      }
    } catch (err) {
      console.error("Erreur ticket mission:", err.message);
      mission.status = "open";
      mission.takerId = null;
      mission.takenAt = null;
      saveState(state);
      await interaction.editReply({
        content: "❌ Impossible de créer le ticket. Contactez un admin.",
        embeds: [],
        components: [],
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  setupMissionPanel,
  handleMissionInteraction,
  MISSION_PANEL_CHANNEL_ID,
};
