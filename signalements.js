const fs = require("fs");
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
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const SIGNALEMENT_PANEL_CHANNEL_ID = "1510000880097693818";
const SIGNALEMENT_LOG_CHANNEL_ID = "1510690066194763786";
const SIGNALEMENT_DELETE_LOG_CHANNEL_ID = "1510687492896981102";
const SIGNALEMENT_ADMIN_ROLE_ID = "1509979964651343993";
const FONDATION_ROLE_ID = "1509974377267990659";

const STATE_FILE = getStatePath("signalements-state.json");

const BTN = {
  ADD: "sig_add",
  EDIT: "sig_edit",
  TABLE: "sig_table",
  RESET: "sig_reset",
  BILAN: "sig_bilan",
  REVEAL: "sig_reveal",
};
const MODAL = {
  ADD: "sig_modal_add",
  REPORT: "sig_modal_report",
};
const SELECT = {
  DELETE: "sig_select_delete",
  REVEAL: "sig_select_reveal",
};

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.reports)) data.reports = [];
    return migrateState(data);
  } catch {
    return { messageId: null, reports: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("signalements-state.json");
}

function isSignalementAdmin(member) {
  return member?.roles.cache.has(SIGNALEMENT_ADMIN_ROLE_ID) ?? false;
}

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
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

function getPrenom(name) {
  return (name || "Inconnu").trim().split(/\s+/)[0].toLowerCase();
}

function normalizeNameKey(name) {
  return (name || "").trim().toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüÿç_-]/gi, "");
}

function migrateReport(report) {
  if (report.entries?.length) return report;
  return {
    ...report,
    entries: [
      {
        description: report.description || "",
        createdAt: report.createdAt || Date.now(),
      },
    ],
    updatedAt: report.updatedAt || report.createdAt || Date.now(),
  };
}

function migrateState(state) {
  state.reports = (state.reports || []).map(migrateReport);
  return state;
}

function getTotalEntryCount(reports) {
  return reports.reduce((n, r) => n + (r.entries?.length || 0), 0);
}

function findExistingReport(reports, targetId, targetName) {
  const prenomKey = getPrenom(targetName);
  const nameKey = normalizeNameKey(prenomKey);

  if (targetId) {
    const byId = reports.find((r) => r.targetId === targetId);
    if (byId) return byId;
  }

  return reports.find((r) => {
    if (targetId && r.targetId && r.targetId === targetId) return true;
    return (
      getPrenom(r.targetName) === prenomKey ||
      normalizeNameKey(getPrenom(r.targetName)) === nameKey
    );
  });
}

function formatEntriesList(entries, maxLen = 600) {
  const lines = entries.map(
    (e) => `• [${formatDateTime(e.createdAt)}] ${e.description}`
  );
  let text = lines.join("\n");
  if (text.length > maxLen) text = text.slice(0, maxLen - 1) + "…";
  return text || "—";
}

function parseTarget(raw, guild) {
  const text = raw.trim();
  const mention = text.match(/^<@!?(\d+)>$/);
  if (mention) {
    const member = guild.members.cache.get(mention[1]);
    return {
      targetId: mention[1],
      targetName: member?.displayName ?? member?.user.username ?? text,
    };
  }
  const idMatch = text.match(/^\d{17,20}$/);
  if (idMatch) {
    const member = guild.members.cache.get(idMatch[0]);
    return {
      targetId: idMatch[0],
      targetName: member?.displayName ?? member?.user.username ?? text,
    };
  }
  const byName = guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === text.toLowerCase() ||
      m.displayName.toLowerCase() === text.toLowerCase()
  );
  if (byName) {
    return { targetId: byName.id, targetName: byName.displayName };
  }
  return { targetId: null, targetName: text };
}

function sortReports(reports) {
  return [...reports].sort((a, b) =>
    getPrenom(a.targetName).localeCompare(getPrenom(b.targetName), "fr")
  );
}

function buildPanelEmbed(state) {
  const people = state.reports.length;
  const total = getTotalEntryCount(state.reports);
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🚨 Panel des signalements")
    .setDescription(
      "Ajoute, modifie ou consulte le tableau des signalements.\n\n" +
        "• **Ajoute signalement** : crée un signalement\n" +
        "• **Modifier/Supprimer** : retirer un dossier existant\n" +
        "• **Tableau** : affiche la liste triée par prénom\n" +
        "• **Reset** : supprime tous les signalements\n" +
        "• **Bilan** : envoie le bilan dans ce salon\n\n" +
        "• **`/report`** : signalement **anonyme** (même pseudo = même dossier)"
    )
    .setFooter({
      text: `Les actions sensibles sont réservées aux admins • ${people} personne(s) • ${total} signalement(s)`,
    });
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.ADD)
        .setLabel("Ajoute signalement")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.EDIT)
        .setLabel("Modifier/Supprimer")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(BTN.TABLE)
        .setLabel("Tableau")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.RESET)
        .setLabel("Reset signalements")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN.BILAN)
        .setLabel("Bilan")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(BTN.REVEAL)
        .setEmoji("👁️")
        .setLabel("Voir l'auteur")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildRevealSelect(state) {
  const sorted = sortReports(state.reports);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.REVEAL)
      .setPlaceholder("Choisir un signalement")
      .addOptions(
        sorted.slice(0, 25).map((r) => ({
          label: r.targetName.slice(0, 100),
          value: r.id,
          description: `${r.entries?.length || 0} signalement(s)`,
        }))
      )
  );
}

function buildRevealEmbed(report) {
  const target = report.targetId
    ? `<@${report.targetId}> (\`${report.targetName}\`)`
    : `**${report.targetName}**`;

  const lines = (report.entries || []).map((e, i) => {
    const author = e.authorId ? `<@${e.authorId}>` : "*Auteur non enregistré*";
    return `**${i + 1}.** [${formatDateTime(e.createdAt)}] par ${author}\n${e.description}`;
  });

  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("👁️ Auteurs du signalement")
    .setDescription(`Personne signalée : ${target}\n\n${lines.join("\n\n").slice(0, 4000) || "—"}`)
    .setTimestamp();
}

function buildSignalementModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("personne")
          .setLabel("Personne signalée (@mention ou pseudo)")
          .setPlaceholder("@Membre ou pseudo Discord")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("comportement")
          .setLabel("Comportement / motif")
          .setPlaceholder("Décrivez le comportement signalé…")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
}

function buildTableEmbed(state) {
  const sorted = sortReports(state.reports);

  if (!sorted.length) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("📋 Tableau des signalements")
      .setDescription("*Aucun signalement enregistré.*");
  }

  const lines = sorted.map((r, i) => {
    const target = r.targetId ? `<@${r.targetId}>` : `**${r.targetName}**`;
    const count = r.entries?.length || 0;
    const latest = r.entries?.[r.entries.length - 1];
    return (
      `**${i + 1}. ${r.targetName.split(/\s+/)[0]}** — ${target} *(${count} signalement${count > 1 ? "s" : ""})*\n` +
      formatEntriesList(r.entries, 400)
    );
  });

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("📋 Tableau des signalements")
    .setDescription(
      `*Trié par prénom • ${sorted.length} personne(s) • ${getTotalEntryCount(sorted)} signalement(s)*\n\n${lines.join("\n\n")}`.slice(
        0,
        4096
      )
    );
}

function buildLogEmbed(report, entry, merged) {
  const target = report.targetId
    ? `<@${report.targetId}> (\`${report.targetName}\`)`
    : `**${report.targetName}**`;
  const count = report.entries?.length || 1;

  return new EmbedBuilder()
    .setColor(merged ? 0xf39c12 : 0xe74c3c)
    .setTitle(
      merged
        ? "🚨 Signalement ajouté au dossier existant"
        : "🚨 Nouveau signalement"
    )
    .setDescription("*Signalement anonyme — l'auteur n'est pas enregistré.*")
    .addFields(
      { name: "Personne signalée", value: target },
      { name: "Comportement", value: entry.description },
      { name: "Date", value: formatDateTime(entry.createdAt), inline: true },
      {
        name: "Dossier",
        value: merged
          ? `${count} signalement(s) au total pour cette personne`
          : "1er signalement",
        inline: true,
      }
    )
    .setTimestamp(new Date(entry.createdAt));
}

function buildDeleteLogEmbed(report, deletedBy) {
  const target = report.targetId
    ? `<@${report.targetId}> (\`${report.targetName}\`)`
    : `**${report.targetName}**`;

  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle("🗑️ Signalement supprimé")
    .addFields(
      { name: "Personne signalée", value: target, inline: true },
      {
        name: "Supprimé par",
        value: `${deletedBy} (\`${deletedBy.tag}\`)`,
        inline: true,
      },
      {
        name: "Signalement(s) perdu(s)",
        value: `${report.entries?.length || 0}`,
        inline: true,
      },
      {
        name: "Dernier motif",
        value: (report.entries?.[report.entries.length - 1]?.description || "—").slice(0, 500),
      },
      { name: "Date de suppression", value: formatDateTime(Date.now()), inline: true }
    )
    .setTimestamp();
}

async function sendSignalementDeleteLog(guild, embed) {
  const logChannel = await guild.channels
    .fetch(SIGNALEMENT_DELETE_LOG_CHANNEL_ID)
    .catch(() => null);
  if (!logChannel?.isTextBased()) {
    console.warn(`Salon logs suppression ${SIGNALEMENT_DELETE_LOG_CHANNEL_ID} introuvable`);
    return;
  }
  await logChannel.send({ embeds: [embed] }).catch(() => null);
}

function buildBilanEmbed(state) {
  const sorted = sortReports(state.reports);
  const details = sorted.length
    ? sorted
        .map((r, i) => {
          const count = r.entries?.length || 0;
          const last = r.entries?.[count - 1];
          return (
            `**${i + 1}.** ${r.targetName} *(${count}×)* — ` +
            `${(last?.description || "").slice(0, 60)}${(last?.description?.length || 0) > 60 ? "…" : ""}`
          );
        })
        .join("\n")
    : "*Aucun signalement.*";

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("📊 Bilan des signalements")
    .setDescription(
      `**${sorted.length} personne(s) • ${getTotalEntryCount(sorted)} signalement(s)**`
    )
    .addFields({ name: "Liste", value: details.slice(0, 1024) })
    .setTimestamp();
}

function buildDeleteSelect(state) {
  const sorted = sortReports(state.reports);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.DELETE)
      .setPlaceholder("Choisir un signalement à supprimer")
      .addOptions(
        sorted.slice(0, 25).map((r) => ({
          label: r.targetName.slice(0, 100),
          value: r.id,
          description: `${r.entries?.length || 0} signalement(s) — ${(r.entries?.[0]?.description || "").slice(0, 80)}`,
        }))
      )
  );
}

async function addReport(guild, personneRaw, comportement, client, authorId) {
  await guild.members.fetch().catch(() => null);

  const { targetId, targetName } = parseTarget(personneRaw, guild);
  const now = Date.now();
  const entry = { description: comportement.trim(), createdAt: now, authorId };

  const state = loadState();
  const existing = findExistingReport(state.reports, targetId, targetName);
  let merged = false;
  let report;

  if (existing) {
    merged = true;
    existing.entries.push(entry);
    existing.updatedAt = now;
    if (targetId && !existing.targetId) {
      existing.targetId = targetId;
      existing.targetName = targetName;
    }
    report = existing;
  } else {
    report = {
      id: `sig_${now}`,
      targetId,
      targetName,
      entries: [entry],
      createdAt: now,
      updatedAt: now,
    };
    state.reports.push(report);
  }

  saveState(state);

  const logChannel = await guild.channels
    .fetch(SIGNALEMENT_LOG_CHANNEL_ID)
    .catch(() => null);
  if (logChannel?.isTextBased()) {
    await logChannel.send({
      embeds: [buildLogEmbed(report, entry, merged)],
    });
  }

  await updateSignalementPanel(guild, client);
  return { report, entry, merged };
}

async function updateSignalementPanel(guild, client) {
  const channel = await client.channels
    .fetch(SIGNALEMENT_PANEL_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  const embed = buildPanelEmbed(state);
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
        m.embeds[0]?.title === "🚨 Panel des signalements"
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

async function setupSignalementPanel(client) {
  for (const guild of client.guilds.cache.values()) {
    await updateSignalementPanel(guild, client);
  }
  console.log("Panel signalements publié");
}

async function registerSignalementCommands(client, token) {
  const commands = [
    new SlashCommandBuilder()
      .setName("report")
      .setDescription("Signaler anonymement le comportement d'un membre")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(token);
  for (const guild of client.guilds.cache.values()) {
    await rest
      .put(Routes.applicationGuildCommands(client.user.id, guild.id), {
        body: commands,
      })
      .catch((err) =>
        console.warn(`Commande /report (${guild.name}):`, err.message)
      );
  }
  console.log("Commande /report enregistrée");
}

function denyAdmin(interaction) {
  return interaction.reply({
    content: "❌ Action réservée à l'**Administration**.",
    ephemeral: true,
  });
}

async function handleSignalementInteraction(interaction, client) {
  if (interaction.isChatInputCommand() && interaction.commandName === "report") {
    await interaction.showModal(
      buildSignalementModal(MODAL.REPORT, "Signalement anonyme")
    );
    return true;
  }

  if (interaction.isButton()) {
    if (
      [BTN.ADD, BTN.EDIT, BTN.RESET, BTN.BILAN].includes(interaction.customId)
    ) {
      if (!isSignalementAdmin(interaction.member)) {
        await denyAdmin(interaction);
        return true;
      }
    }

    if (interaction.customId === BTN.ADD) {
      await interaction.showModal(
        buildSignalementModal(MODAL.ADD, "Ajouter un signalement")
      );
      return true;
    }

    if (interaction.customId === BTN.EDIT) {
      const state = loadState();
      if (!state.reports.length) {
        await interaction.reply({
          content: "ℹ️ Aucun signalement à supprimer.",
          ephemeral: true,
        });
        return true;
      }
      await interaction.reply({
        content: "Sélectionnez le signalement à **supprimer** :",
        components: [buildDeleteSelect(state)],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.TABLE) {
      const state = loadState();
      await interaction.reply({
        embeds: [buildTableEmbed(state)],
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.RESET) {
      const state = loadState();
      state.reports = [];
      saveState(state);
      await updateSignalementPanel(interaction.guild, client);
      await interaction.reply({
        content: "🔄 Tous les signalements ont été supprimés.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.BILAN) {
      const state = loadState();
      await interaction.channel.send({ embeds: [buildBilanEmbed(state)] });
      await interaction.reply({
        content: "📊 Bilan envoyé.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === BTN.REVEAL) {
      if (!isFondation(interaction.member)) {
        await interaction.reply({
          content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut voir les auteurs des signalements.`,
          ephemeral: true,
        });
        return true;
      }

      const state = loadState();
      if (!state.reports.length) {
        await interaction.reply({
          content: "ℹ️ Aucun signalement enregistré.",
          ephemeral: true,
        });
        return true;
      }

      await interaction.reply({
        content: "👁️ Sélectionnez le signalement dont vous voulez voir l'auteur :",
        components: [buildRevealSelect(state)],
        ephemeral: true,
      });
      return true;
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === SELECT.DELETE
  ) {
    if (!isSignalementAdmin(interaction.member)) {
      await denyAdmin(interaction);
      return true;
    }

    const id = interaction.values[0];
    const state = loadState();
    const idx = state.reports.findIndex((r) => r.id === id);
    if (idx === -1) {
      await interaction.update({
        content: "❌ Signalement introuvable.",
        components: [],
      });
      return true;
    }

    const removed = state.reports.splice(idx, 1)[0];
    saveState(state);
    await updateSignalementPanel(interaction.guild, client);
    await sendSignalementDeleteLog(
      interaction.guild,
      buildDeleteLogEmbed(removed, interaction.user)
    );

    await interaction.update({
      content: `✅ Signalement **${removed.targetName}** supprimé.`,
      components: [],
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === SELECT.REVEAL
  ) {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut voir les auteurs des signalements.`,
        ephemeral: true,
      });
      return true;
    }

    const id = interaction.values[0];
    const state = loadState();
    const report = state.reports.find((r) => r.id === id);

    if (!report) {
      await interaction.update({
        content: "❌ Signalement introuvable.",
        components: [],
      });
      return true;
    }

    await interaction.update({
      content: "",
      embeds: [buildRevealEmbed(report)],
      components: [],
    });
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (
      interaction.customId === MODAL.REPORT ||
      interaction.customId === MODAL.ADD
    ) {
      if (interaction.customId === MODAL.ADD && !isSignalementAdmin(interaction.member)) {
        await interaction.reply({
          content: "❌ Action réservée à l'Administration.",
          ephemeral: true,
        });
        return true;
      }

      const personne = interaction.fields.getTextInputValue("personne");
      const comportement = interaction.fields.getTextInputValue("comportement");

      if (!comportement.trim()) {
        await interaction.reply({
          content: "❌ Motif requis.",
          ephemeral: true,
        });
        return true;
      }

      const result = await addReport(
        interaction.guild,
        personne,
        comportement,
        interaction.client,
        interaction.user.id
      );

      if (interaction.customId === MODAL.REPORT) {
        await interaction.reply({
          content: result.merged
            ? `✅ Signalement **anonyme** ajouté au dossier **${result.report.targetName}** (${result.report.entries.length} au total).`
            : "✅ Signalement **anonyme** enregistré.\nIl a été transmis à l'administration. Merci.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: result.merged
            ? `✅ Ajouté au dossier **${result.report.targetName}** (${result.report.entries.length} signalement(s)).`
            : "✅ Signalement ajouté au tableau.",
          ephemeral: true,
        });
      }
      return true;
    }
  }

  return false;
}

function getWeeklyBilanEmbed() {
  return buildBilanEmbed(loadState());
}

module.exports = {
  setupSignalementPanel,
  registerSignalementCommands,
  handleSignalementInteraction,
  getWeeklyBilanEmbed,
};
