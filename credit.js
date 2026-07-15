const fs = require("fs");
const { getStatePath, persistState } = require("./storage");
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const CREDIT_CHANNEL_ID = "1511135082927100104";
const CREDIT_LOG_CHANNEL_ID = "1510687492896981102";
const GERANTS_ROLE_ID = "1509985135565475850";

const STATE_FILE = getStatePath("credit-state.json");

const SELECT_DURATION = "credit_select_duration";
const MODAL_CREDIT = "credit_modal";
const APPROVE_PREFIX = "credit_approve_";
const REJECT_PREFIX = "credit_reject_";
const BTN_TABLE_REMOVE = "credit_table_remove";
const SELECT_REMOVE_CREDIT = "credit_select_remove";
const REMOVE_CONFIRM_PREFIX = "credit_remove_yes_";
const REMOVE_CANCEL = "credit_remove_cancel";

const DURATIONS = {
  "1": { label: "1 mois", rate: 0.05, rateLabel: "5 %" },
  "2": { label: "2 mois", rate: 0.1, rateLabel: "10 %" },
  "3": { label: "Plus de 2 mois", rate: 0.25, rateLabel: "25 %" },
};

const creditSessions = new Map();

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.credits)) data.credits = [];
    return data;
  } catch {
    return { messageId: null, credits: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("credit-state.json");
}

function isGerant(member) {
  return member?.roles.cache.has(GERANTS_ROLE_ID) ?? false;
}

function parseAmount(str) {
  const n = parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatEuro(amount) {
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
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

function getCreditStartDate(credit) {
  return credit.approvedAt ?? credit.createdAt;
}

function getDueDate(credit) {
  const d = new Date(getCreditStartDate(credit));
  const months =
    credit.durationKey === "1" ? 1 : credit.durationKey === "2" ? 2 : 3;
  d.setMonth(d.getMonth() + months);
  return d;
}

function calcTotalDue(amount, rate) {
  return Math.round(amount * (1 + rate) * 100) / 100;
}

function getActiveCredits(state) {
  return state.credits.filter((c) => c.status === "active");
}

function getCredit(state, creditId) {
  return state.credits.find((c) => c.id === creditId);
}

function buildDurationSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_DURATION)
      .setPlaceholder("📅 Quand remboursez-vous ?")
      .addOptions(
        {
          label: "1 mois",
          value: "1",
          description: "Taux d'intérêt : 5 %",
          emoji: "📆",
        },
        {
          label: "2 mois",
          value: "2",
          description: "Taux d'intérêt : 10 %",
          emoji: "📆",
        },
        {
          label: "Plus de 2 mois",
          value: "3",
          description: "Taux d'intérêt : 25 %",
          emoji: "📆",
        }
      )
  );
}

function buildCreditModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_CREDIT)
    .setTitle("💳 Demande de crédit")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("montant")
          .setLabel("Montant du crédit (€)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Ex. 500")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("raison")
          .setLabel("Raison du crédit")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function buildCreditDetailFields(credit) {
  const dur = DURATIONS[credit.durationKey];
  const totalDue = calcTotalDue(credit.amount, credit.interestRate);
  const interestAmount = totalDue - credit.amount;

  return [
    { name: "Montant", value: formatEuro(credit.amount), inline: true },
    { name: "Remboursement", value: dur.label, inline: true },
    { name: "Taux d'intérêt", value: dur.rateLabel, inline: true },
    { name: "Intérêts", value: formatEuro(interestAmount), inline: true },
    {
      name: "Total à rembourser",
      value: `**${formatEuro(totalDue)}**`,
      inline: true,
    },
    { name: "Raison", value: credit.reason },
  ];
}

function buildPendingCreditEmbed(credit, member) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("⏳ Demande de crédit en attente")
    .setDescription(
      `${member ? `${member} (\`${member.user.tag}\`)` : `<@${credit.userId}>`} demande un crédit.\n\n` +
        `Un **Gérant** <@&${GERANTS_ROLE_ID}> doit **accepter** ou **refuser**.`
    )
    .addFields(buildCreditDetailFields(credit))
    .setFooter({ text: `Réf. ${credit.id}` })
    .setTimestamp(new Date(credit.createdAt));
}

function buildTableComponents(state) {
  const active = getActiveCredits(state);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_TABLE_REMOVE)
        .setLabel("Supprimer un crédit")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(active.length === 0)
    ),
  ];
}

function buildRemoveCreditSelect(state) {
  const active = getActiveCredits(state);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_REMOVE_CREDIT)
      .setPlaceholder("Choisir le crédit à supprimer")
      .addOptions(
        active.slice(0, 25).map((c) => {
          const dur = DURATIONS[c.durationKey];
          const total = calcTotalDue(c.amount, c.interestRate);
          return {
            label: `${formatEuro(c.amount)} — ${c.reason.slice(0, 40)}`.slice(0, 100),
            value: c.id,
            description: `${dur.label} • ${formatEuro(total)}`.slice(0, 100),
          };
        })
      )
  );
}

function buildRemoveConfirmEmbed(credit) {
  const dur = DURATIONS[credit.durationKey];
  const total = calcTotalDue(credit.amount, credit.interestRate);
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🗑️ Confirmer la suppression")
    .setDescription(
      `Supprimer le crédit de <@${credit.userId}> du tableau ?\n\n` +
        `Cette action est **définitive** (crédit marqué comme remboursé / clos).`
    )
    .addFields(
      { name: "Montant", value: formatEuro(credit.amount), inline: true },
      { name: "Total dû", value: formatEuro(total), inline: true },
      { name: "Délai", value: dur.label, inline: true },
      { name: "Raison", value: credit.reason }
    )
    .setFooter({ text: `Réf. ${credit.id}` });
}

function buildRemoveConfirmRow(creditId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${REMOVE_CONFIRM_PREFIX}${creditId}`)
      .setLabel("Confirmer la suppression")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(REMOVE_CANCEL)
      .setLabel("Annuler")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildApprovedCreditEmbed(credit, validator) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Crédit accepté")
    .addFields(
      {
        name: "Membre",
        value: `<@${credit.userId}>`,
        inline: true,
      },
      {
        name: "Validé par",
        value: `${validator}`,
        inline: true,
      },
      ...buildCreditDetailFields(credit),
      {
        name: "Échéance estimée",
        value: formatDateTime(getDueDate(credit)),
        inline: true,
      }
    )
    .setFooter({ text: `Réf. ${credit.id}` })
    .setTimestamp(new Date(credit.approvedAt));
}

function buildClosedCreditEmbed(credit, validator) {
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle("📋 Crédit clôturé")
    .addFields(
      {
        name: "Membre",
        value: `<@${credit.userId}>`,
        inline: true,
      },
      {
        name: "Clôturé par",
        value: `${validator}`,
        inline: true,
      },
      ...buildCreditDetailFields(credit),
      {
        name: "Clôturé le",
        value: formatDateTime(credit.removedAt),
        inline: true,
      }
    )
    .setFooter({ text: `Réf. ${credit.id}` })
    .setTimestamp(new Date(credit.removedAt));
}

function buildRejectedCreditEmbed(credit, validator) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("❌ Crédit refusé")
    .addFields(
      {
        name: "Membre",
        value: `<@${credit.userId}>`,
        inline: true,
      },
      {
        name: "Refusé par",
        value: `${validator}`,
        inline: true,
      },
      ...buildCreditDetailFields(credit)
    )
    .setFooter({ text: `Réf. ${credit.id}` })
    .setTimestamp(new Date(credit.rejectedAt));
}

function buildValidationRow(creditId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${creditId}`)
      .setLabel("Accepter")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${REJECT_PREFIX}${creditId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildTableEmbed(state) {
  const active = getActiveCredits(state);

  if (!active.length) {
    return new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📊 Tableau des crédits — Maison")
      .setDescription("*Aucun crédit en cours pour le moment.*")
      .setFooter({ text: "Taux : 5 % (1 mois) • 10 % (2 mois) • 25 % (+2 mois)" })
      .setTimestamp();
  }

  const lines = active.map((c, i) => {
    const dur = DURATIONS[c.durationKey];
    const total = calcTotalDue(c.amount, c.interestRate);
    const since = getCreditStartDate(c);
    return (
      `**${i + 1}.** <@${c.userId}>\n` +
      `└ Montant : **${formatEuro(c.amount)}** → Total dû : **${formatEuro(total)}** (${dur.rateLabel})\n` +
      `└ Remboursement : **${dur.label}** — échéance ~${formatDateTime(getDueDate(c))}\n` +
      `└ Depuis : ${formatDateTime(since)}\n` +
      `└ Raison : *${c.reason.slice(0, 120)}${c.reason.length > 120 ? "…" : ""}*`
    );
  });

  let body = lines.join("\n\n");
  if (body.length > 3800) {
    body = lines.slice(0, 8).join("\n\n") + `\n\n*… et ${active.length - 8} autre(s) crédit(s)*`;
  }

  const totalPrincipal = active.reduce((s, c) => s + c.amount, 0);
  const totalDue = active.reduce(
    (s, c) => s + calcTotalDue(c.amount, c.interestRate),
    0
  );

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📊 Tableau des crédits — Maison")
    .setDescription(body)
    .addFields(
      {
        name: "Crédits actifs",
        value: String(active.length),
        inline: true,
      },
      {
        name: "Capital total",
        value: formatEuro(totalPrincipal),
        inline: true,
      },
      {
        name: "Total à rembourser",
        value: formatEuro(totalDue),
        inline: true,
      }
    )
    .setFooter({ text: "Taux : 5 % (1 mois) • 10 % (2 mois) • 25 % (+2 mois)" })
    .setTimestamp();
}

async function updateCreditTable(client) {
  const channel = await client.channels.fetch(CREDIT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  const embed = buildTableEmbed(state);

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    msg = messages?.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title?.includes("Tableau des crédits")
    );
  }

  const components = buildTableComponents(state);

  if (msg) {
    await msg.edit({ embeds: [embed], components });
    state.messageId = msg.id;
  } else {
    const sent = await channel.send({ embeds: [embed], components });
    state.messageId = sent.id;
  }
  saveState(state);
}

async function setupCreditTable(client) {
  await updateCreditTable(client);
  console.log("Tableau crédits publié");
}

async function sendCreditLog(client, embed) {
  const channel = await client.channels
    .fetch(CREDIT_LOG_CHANNEL_ID)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`Salon logs crédit ${CREDIT_LOG_CHANNEL_ID} introuvable`);
    return;
  }
  await channel.send({ embeds: [embed] });
}

async function deletePendingRequestMessage(client, credit, interactionMessage) {
  const state = loadState();
  const isTableMessage =
    state.messageId &&
    interactionMessage?.id === state.messageId;

  if (isTableMessage) return;

  if (interactionMessage) {
    await interactionMessage.delete().catch(() => null);
    return;
  }

  if (!credit.pendingMessageId) return;

  const channel = await client.channels.fetch(CREDIT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const msg = await channel.messages.fetch(credit.pendingMessageId).catch(() => null);
  if (msg && msg.id !== state.messageId) {
    await msg.delete().catch(() => null);
  }
}

async function notifyRequester(guild, credit, approved) {
  const member = await guild.members.fetch(credit.userId).catch(() => null);
  if (!member) return;

  const dur = DURATIONS[credit.durationKey];
  const totalDue = calcTotalDue(credit.amount, credit.interestRate);

  if (approved) {
    await member
      .send(
        `✅ Votre demande de crédit a été **acceptée**.\n\n` +
          `**Montant :** ${formatEuro(credit.amount)}\n` +
          `**Raison :** ${credit.reason}\n` +
          `**Remboursement :** ${dur.label} (${dur.rateLabel})\n` +
          `**Total à rembourser :** ${formatEuro(totalDue)}\n` +
          `**Échéance estimée :** ${formatDateTime(getDueDate(credit))}`
      )
      .catch(() => null);
  } else {
    await member
      .send(
        `❌ Votre demande de crédit a été **refusée**.\n\n` +
          `**Montant :** ${formatEuro(credit.amount)}\n` +
          `**Raison :** ${credit.reason}\n\n` +
          `Vous pouvez refaire une demande avec \`/crédit\` si besoin.`
      )
      .catch(() => null);
  }
}

function denyGerant(interaction) {
  return interaction.reply({
    content: `❌ Seuls les **Gérants** <@&${GERANTS_ROLE_ID}> peuvent gérer les crédits.`,
    ephemeral: true,
  });
}

async function removeCredit(interaction, client, creditId) {
  if (!isGerant(interaction.member)) {
    await denyGerant(interaction);
    return;
  }

  const state = loadState();
  const credit = getCredit(state, creditId);

  if (!credit || credit.status !== "active") {
    await interaction.update({
      content: "❌ Ce crédit n'est plus actif ou introuvable.",
      embeds: [],
      components: [],
    });
    return;
  }

  credit.status = "removed";
  credit.removedAt = Date.now();
  credit.removedById = interaction.user.id;
  saveState(state);

  await sendCreditLog(client, buildClosedCreditEmbed(credit, interaction.member));
  await updateCreditTable(client);

  const guild = interaction.guild;
  if (guild) {
    const member = await guild.members.fetch(credit.userId).catch(() => null);
    if (member) {
      await member
        .send(
          `📋 Votre crédit de **${formatEuro(credit.amount)}** a été **clôturé** ` +
            `(supprimé du tableau par un Gérant).\n**Raison initiale :** ${credit.reason}`
        )
        .catch(() => null);
    }
  }

  await interaction.update({
    content:
      `✅ Crédit supprimé du tableau — <@${credit.userId}> · **${formatEuro(credit.amount)}**.`,
    embeds: [],
    components: [],
  });
}

async function validateCredit(interaction, client, creditId, approved) {
  if (!isGerant(interaction.member)) {
    await interaction.reply({
      content: `❌ Seuls les **Gérants** <@&${GERANTS_ROLE_ID}> peuvent valider les crédits.`,
      ephemeral: true,
    });
    return;
  }

  const state = loadState();
  const credit = getCredit(state, creditId);

  if (!credit || credit.status !== "pending") {
    await interaction.reply({
      content: "❌ Cette demande n'est plus en attente.",
      ephemeral: true,
    });
    return;
  }

  if (approved) {
    credit.status = "active";
    credit.approvedAt = Date.now();
    credit.validatorId = interaction.user.id;
  } else {
    credit.status = "rejected";
    credit.rejectedAt = Date.now();
    credit.validatorId = interaction.user.id;
  }
  credit.pendingMessageId = null;
  saveState(state);

  const embed = approved
    ? buildApprovedCreditEmbed(credit, interaction.member)
    : buildRejectedCreditEmbed(credit, interaction.member);

  await interaction.deferUpdate();
  await sendCreditLog(client, embed);
  await deletePendingRequestMessage(client, credit, interaction.message);

  await notifyRequester(interaction.guild, credit, approved);

  if (approved) {
    await updateCreditTable(client);
  }

  await interaction.followUp({
    content: approved
      ? `✅ Crédit accepté — enregistré dans les logs. Tableau mis à jour.`
      : `❌ Demande refusée — enregistrée dans les logs.`,
    ephemeral: true,
  });
}

async function handleCreditInteraction(interaction, client) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith(APPROVE_PREFIX)) {
      const creditId = interaction.customId.slice(APPROVE_PREFIX.length);
      await validateCredit(interaction, client, creditId, true);
      return true;
    }
    if (interaction.customId.startsWith(REJECT_PREFIX)) {
      const creditId = interaction.customId.slice(REJECT_PREFIX.length);
      await validateCredit(interaction, client, creditId, false);
      return true;
    }
    if (interaction.customId === BTN_TABLE_REMOVE) {
      if (!isGerant(interaction.member)) {
        await denyGerant(interaction);
        return true;
      }
      const state = loadState();
      const active = getActiveCredits(state);
      if (!active.length) {
        await interaction.reply({
          content: "ℹ️ Aucun crédit actif à supprimer.",
          ephemeral: true,
        });
        return true;
      }
      await interaction.reply({
        content: "🗑️ Sélectionnez le crédit à **supprimer** du tableau :",
        components: [buildRemoveCreditSelect(state)],
        ephemeral: true,
      });
      return true;
    }
    if (interaction.customId.startsWith(REMOVE_CONFIRM_PREFIX)) {
      const creditId = interaction.customId.slice(REMOVE_CONFIRM_PREFIX.length);
      await removeCredit(interaction, client, creditId);
      return true;
    }
    if (interaction.customId === REMOVE_CANCEL) {
      await interaction.update({
        content: "❌ Suppression annulée.",
        embeds: [],
        components: [],
      });
      return true;
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === SELECT_REMOVE_CREDIT
  ) {
    if (!isGerant(interaction.member)) {
      await denyGerant(interaction);
      return true;
    }
    const creditId = interaction.values[0];
    const state = loadState();
    const credit = getCredit(state, creditId);
    if (!credit || credit.status !== "active") {
      await interaction.update({
        content: "❌ Ce crédit n'est plus actif.",
        components: [],
      });
      return true;
    }
    await interaction.update({
      content: "Validez la suppression ci-dessous :",
      embeds: [buildRemoveConfirmEmbed(credit)],
      components: [buildRemoveConfirmRow(creditId)],
    });
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "crédit") {
    await interaction.reply({
      content: "💳 **Demande de crédit** — choisissez d'abord votre délai de remboursement :",
      components: [buildDurationSelect()],
      ephemeral: true,
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === SELECT_DURATION
  ) {
    const durationKey = interaction.values[0];
    if (!DURATIONS[durationKey]) {
      await interaction.reply({
        content: "❌ Délai invalide.",
        ephemeral: true,
      });
      return true;
    }

    creditSessions.set(interaction.user.id, {
      durationKey,
      guildId: interaction.guild?.id,
    });

    await interaction.showModal(buildCreditModal());
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL_CREDIT) {
    const session = creditSessions.get(interaction.user.id);
    if (!session?.durationKey || !DURATIONS[session.durationKey]) {
      await interaction.reply({
        content: "❌ Session expirée — relancez `/crédit`.",
        ephemeral: true,
      });
      return true;
    }

    const amount = parseAmount(interaction.fields.getTextInputValue("montant"));
    const reason = interaction.fields.getTextInputValue("raison").trim();

    if (!amount) {
      await interaction.reply({
        content: "❌ Montant invalide. Indiquez un nombre positif (ex. 500).",
        ephemeral: true,
      });
      return true;
    }

    if (!reason) {
      await interaction.reply({
        content: "❌ La raison est obligatoire.",
        ephemeral: true,
      });
      return true;
    }

    const dur = DURATIONS[session.durationKey];
    const state = loadState();
    const credit = {
      id: `cred_${Date.now()}`,
      userId: interaction.user.id,
      guildId: interaction.guild?.id,
      amount,
      reason,
      durationKey: session.durationKey,
      interestRate: dur.rate,
      createdAt: Date.now(),
      status: "pending",
      approvedAt: null,
      rejectedAt: null,
      validatorId: null,
    };

    state.credits.push(credit);
    saveState(state);
    creditSessions.delete(interaction.user.id);

    const channel = await client.channels.fetch(CREDIT_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) {
      const msg = await channel.send({
        content: `<@&${GERANTS_ROLE_ID}>`,
        embeds: [buildPendingCreditEmbed(credit, interaction.member)],
        components: [buildValidationRow(credit.id)],
      });
      credit.pendingMessageId = msg.id;
      saveState(state);
    }

    const totalDue = calcTotalDue(amount, dur.rate);
    await interaction.reply({
      content:
        `⏳ Demande envoyée — en attente de validation par un **Gérant**.\n\n` +
        `**Montant :** ${formatEuro(amount)}\n` +
        `**Raison :** ${reason}\n` +
        `**Remboursement :** ${dur.label} (${dur.rateLabel})\n` +
        `**Total à rembourser (si accepté) :** ${formatEuro(totalDue)}\n\n` +
        `Vous recevrez un **message privé** dès qu'un Gérant aura accepté ou refusé.`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  setupCreditTable,
  updateCreditTable,
  handleCreditInteraction,
  CREDIT_CHANNEL_ID,
};
