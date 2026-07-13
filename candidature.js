const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");

const CANDIDATURE_CATEGORY_ID = "1509979339649843200";
const CANDIDATURE_LOG_CHANNEL_ID = "1509980081764700271";
const ADMIN_VOTE_ROLE_ID = "1509979964651343993";
const CHEF_USER_ID = "1445816241116807238";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const QUESTION_TIMEOUT_MS = 30 * 60 * 1000;
const VOTES_REQUIRED = 2;

const CANDIDATURE_QUESTIONS = [
  {
    key: "paiement_annuel",
    prompt:
      "Êtes-vous prêt(e) à payer **1 000 € par an** pour l'hébergement à la Maison ? (Oui / Non)",
  },
  { key: "prenom", prompt: "Quel est votre **prénom** ?" },
  { key: "age", prompt: "Quel est votre **âge** ?" },
  { key: "sexe", prompt: "Quel est votre **sexe** ?" },
  { key: "lieu", prompt: "**Pays / Ville** :" },
  { key: "presentation", prompt: "**Présentez-vous** en quelques lignes :" },
  { key: "qualites", prompt: "Quelles sont vos **qualités** ?" },
  { key: "defauts", prompt: "Quels sont vos **défauts** ?" },
  { key: "passions", prompt: "Vos **passions / loisirs** :" },
  {
    key: "situation",
    prompt: "Votre **situation actuelle** (études, travail, etc.) :",
  },
  {
    key: "motivation_pourquoi",
    prompt: "**Pourquoi** souhaitez-vous rejoindre la Maison ?",
  },
  {
    key: "motivation_connu",
    prompt: "**Comment** avez-vous connu la Maison ?",
  },
  {
    key: "motivation_attentes",
    prompt: "Qu'**attendez-vous** de la Maison ?",
  },
  {
    key: "motivation_apport",
    prompt: "Que pouvez-vous **apporter** à la communauté ?",
  },
  {
    key: "motivation_accepter",
    prompt: "**Pourquoi** devrions-nous vous accepter ?",
  },
  { key: "actif_discord", prompt: "Êtes-vous **actif sur Discord** ?" },
  {
    key: "heures",
    prompt: "Combien d'**heures par jour** pouvez-vous être présent ?",
  },
  {
    key: "groupe",
    prompt: "Savez-vous **travailler en groupe** et respecter des règles ?",
  },
  {
    key: "conflits",
    prompt: "Comment réagissez-vous dans les **conflits** ?",
  },
  {
    key: "reglement",
    prompt: "Acceptez-vous le **règlement** de la Maison ? (Oui / Non)",
  },
  {
    key: "respect_staff",
    prompt:
      "Êtes-vous prêt à **respecter le staff** et les autres membres ? (Oui / Non)",
  },
  {
    key: "privilege",
    prompt:
      "Comprenez-vous que l'hébergement est un **privilège** et non un droit ? (Oui / Non)",
  },
  {
    key: "photo",
    prompt:
      "**Photo / avatar** (facultatif — envoyez un fichier ou tapez `passer`) :",
    optional: true,
  },
  {
    key: "reseaux",
    prompt: "**Réseaux sociaux** (facultatif — tapez `passer` pour ignorer) :",
    optional: true,
  },
  {
    key: "autres",
    prompt:
      "**Autres informations utiles** (facultatif — tapez `passer` pour ignorer) :",
    optional: true,
  },
];

const activeSessions = new Map();
const candidatureVotes = new Map();
const reminderTimeouts = new Map();

function voteButtonIds(channelId, chef = false) {
  const prefix = chef ? "candidature_chef" : "candidature";
  return {
    pour: `${prefix}_pour_${channelId}`,
    contre: `${prefix}_contre_${channelId}`,
  };
}

function parseVoteCustomId(customId) {
  const patterns = [
    { prefix: "candidature_chef_pour_", type: "pour", chef: true },
    { prefix: "candidature_chef_contre_", type: "contre", chef: true },
    { prefix: "candidature_pour_", type: "pour", chef: false },
    { prefix: "candidature_contre_", type: "contre", chef: false },
  ];

  for (const p of patterns) {
    if (customId.startsWith(p.prefix)) {
      return {
        type: p.type,
        chef: p.chef,
        channelId: customId.slice(p.prefix.length),
      };
    }
  }
  return null;
}

function isCandidatureCategory(parentId) {
  return parentId === CANDIDATURE_CATEGORY_ID;
}

function getVoteState(channelId) {
  if (!candidatureVotes.has(channelId)) {
    candidatureVotes.set(channelId, {
      pour: new Set(),
      contre: new Set(),
      logMessageId: null,
      round: 1,
      status: "voting",
      answers: null,
      memberId: null,
    });
  }
  return candidatureVotes.get(channelId);
}

function buildVoteRow(channelId, chef = false) {
  const ids = voteButtonIds(channelId, chef);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.pour)
      .setLabel("Pour")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ids.contre)
      .setLabel("Contre")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

function fieldBlock(lines) {
  return lines
    .map(([label, val]) => `**${label} :** ${(val || "—").toString()}`)
    .join("\n")
    .slice(0, 1024);
}

function buildCandidatureResultEmbed(member, answers) {
  return new EmbedBuilder()
    .setColor(0x800020)
    .setTitle(`📋 Candidature — ${member.user.tag}`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setDescription(
      `${member}\n*Candidature complète — votes anonymes (2 requis)*`
    )
    .addFields(
      {
        name: "💶 Engagement financier",
        value: fieldBlock([["Paiement 1 000 € / an", answers.paiement_annuel]]),
      },
      {
        name: "👤 Informations personnelles",
        value: fieldBlock([
          ["Prénom", answers.prenom],
          ["Âge", answers.age],
          ["Sexe", answers.sexe],
          ["Pays / Ville", answers.lieu],
        ]),
      },
      {
        name: "🏠 À propos de vous",
        value: fieldBlock([
          ["Présentation", answers.presentation],
          ["Qualités", answers.qualites],
          ["Défauts", answers.defauts],
          ["Passions / loisirs", answers.passions],
          ["Situation", answers.situation],
        ]),
      },
      {
        name: "🎯 Motivation",
        value: fieldBlock([
          ["Pourquoi rejoindre", answers.motivation_pourquoi],
          ["Comment connu", answers.motivation_connu],
          ["Attentes", answers.motivation_attentes],
          ["Apport", answers.motivation_apport],
          ["Pourquoi accepter", answers.motivation_accepter],
        ]),
      },
      {
        name: "🧠 Comportement & activité",
        value: fieldBlock([
          ["Actif Discord", answers.actif_discord],
          ["Heures / jour", answers.heures],
          ["Travail en groupe", answers.groupe],
          ["Conflits", answers.conflits],
        ]),
      },
      {
        name: "🔒 Engagement",
        value: fieldBlock([
          ["Règlement", answers.reglement],
          ["Respect staff", answers.respect_staff],
          ["Privilège hébergement", answers.privilege],
        ]),
      },
      {
        name: "📸 Facultatif",
        value: fieldBlock([
          ["Photo / avatar", answers.photo || "Non renseigné"],
          ["Réseaux", answers.reseaux || "Non renseigné"],
          ["Autres", answers.autres || "Non renseigné"],
        ]),
      }
    )
    .setTimestamp();
}

function buildWaitingEmbed() {
  return new EmbedBuilder()
    .setColor(0x800020)
    .setTitle("📋 Candidature envoyée")
    .setDescription(
      "✅ Votre formulaire a bien été transmis à l'administration.\n\n" +
        "**En attente de vos résultats.**\n\n" +
        "Vous serez informé(e) ici dès qu'une décision aura été prise.\n" +
        "*Merci pour votre patience.* 🦋"
    );
}

async function clearChannel(channel) {
  for (let i = 0; i < 6; i++) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) break;
    const deletable = messages.filter(
      (m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
    );
    if (deletable.size > 1) {
      await channel.bulkDelete(deletable, true).catch(() => null);
    } else if (deletable.size === 1) {
      await deletable.first().delete().catch(() => null);
    }
    for (const msg of messages.values()) {
      if (!deletable.has(msg.id)) await msg.delete().catch(() => null);
    }
    if (messages.size < 100) break;
  }
}

async function updateLogVoteMessage(channel, guild, stats, extraFooter) {
  if (!stats.logMessageId) return;
  const logChannel = guild.channels.cache.get(CANDIDATURE_LOG_CHANNEL_ID);
  if (!logChannel?.isTextBased()) return;

  const msg = await logChannel.messages.fetch(stats.logMessageId).catch(() => null);
  if (!msg) return;

  const member = await guild.members.fetch(stats.memberId).catch(() => null);
  if (!member) return;

  const embed = buildCandidatureResultEmbed(member, stats.answers);
  if (extraFooter) embed.setFooter({ text: extraFooter });

  let components = [];
  if (stats.status === "voting" || stats.status === "round2") {
    components = [buildVoteRow(channel.id)];
  } else if (stats.status === "awaiting_chef") {
    components = [buildVoteRow(channel.id, true)];
  }

  await msg.edit({ embeds: [embed], components }).catch(() => null);
}

async function notifyCandidateResult(channel, accepted, reason) {
  const embed = new EmbedBuilder()
    .setColor(accepted ? 0x2ecc71 : 0xe74c3c)
    .setTitle(accepted ? "✅ Candidature acceptée" : "❌ Candidature refusée")
    .setDescription(
      accepted
        ? "Félicitations ! Votre candidature a été **acceptée**.\nUn membre du staff vous contactera prochainement."
        : `Votre candidature n'a pas été retenue.\n${reason || "Merci pour votre intérêt."}`
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function closeCandidatureVoting(channel, guild, stats) {
  const timeout = reminderTimeouts.get(channel.id);
  if (timeout) {
    clearTimeout(timeout);
    reminderTimeouts.delete(channel.id);
  }

  if (stats.logMessageId) {
    const logChannel = guild.channels.cache.get(CANDIDATURE_LOG_CHANNEL_ID);
    const msg = await logChannel?.messages
      .fetch(stats.logMessageId)
      .catch(() => null);
    if (msg) await msg.edit({ components: [] }).catch(() => null);
  }

  await channel
    .setTopic(`${channel.topic}:closed`)
    .catch(() => null);
}

async function finalizeCandidature(channel, guild, stats, accepted, reason) {
  stats.status = accepted ? "accepted" : "rejected";
  await notifyCandidateResult(channel, accepted, reason);
  await updateLogVoteMessage(
    channel,
    guild,
    stats,
    accepted ? "Décision : Acceptée" : "Décision : Refusée"
  );
  await closeCandidatureVoting(channel, guild, stats);
}

async function startSecondRound(channel, guild, stats) {
  stats.pour.clear();
  stats.contre.clear();
  stats.round = 2;
  stats.status = "round2";

  await updateLogVoteMessage(
    channel,
    guild,
    stats,
    "⚖️ Égalité — Second tour (2 votes anonymes requis)"
  );

  const logChannel = guild.channels.cache.get(CANDIDATURE_LOG_CHANNEL_ID);
  if (logChannel?.isTextBased()) {
    await logChannel
      .send(
        `⚖️ **Second tour** pour la candidature <#${channel.id}> — égalité au premier vote.`
      )
      .catch(() => null);
  }
}

async function requestChefDecision(channel, guild, stats, member) {
  stats.status = "awaiting_chef";
  stats.pour.clear();
  stats.contre.clear();

  await updateLogVoteMessage(
    channel,
    guild,
    stats,
    "👑 Égalité au 2e tour — En attente de la cheffe"
  );

  const logChannel = guild.channels.cache.get(CANDIDATURE_LOG_CHANNEL_ID);
  if (logChannel?.isTextBased()) {
    await logChannel
      .send(
        `👑 **Décision cheffe requise** — égalité sur la candidature de ${member} (<#${channel.id}>).`
      )
      .catch(() => null);
  }

  const chef = await guild.members.fetch(CHEF_USER_ID).catch(() => null);
  if (chef) {
    await chef
      .send(
        `👑 **Décision requise**\n\n` +
          `Égalité au second tour pour la candidature de **${member.user.tag}**.\n` +
          `Salon logs : <#${CANDIDATURE_LOG_CHANNEL_ID}>\n` +
          `Ticket : ${channel}\n\n` +
          `Utilisez les boutons **Pour** / **Contre** sur le message de vote (réservés à vous).`
      )
      .catch(() => null);
  }
}

async function evaluateVotes(channel, guild, stats, member) {
  const total = stats.pour.size + stats.contre.size;
  if (total < VOTES_REQUIRED) return;

  const pour = stats.pour.size;
  const contre = stats.contre.size;

  if (pour > contre) {
    await finalizeCandidature(channel, guild, stats, true);
    return;
  }
  if (contre > pour) {
    await finalizeCandidature(channel, guild, stats, false);
    return;
  }

  if (stats.round === 1) {
    await startSecondRound(channel, guild, stats);
    return;
  }

  await requestChefDecision(channel, guild, stats, member);
}

async function notifyAdminsPending(guild, channel, member) {
  const role = guild.roles.cache.get(ADMIN_VOTE_ROLE_ID);
  if (!role) return;

  const text =
    `⏰ **Rappel candidature**\n\n` +
    `La candidature de **${member.user.tag}** est en attente depuis **plus de 3 jours**.\n` +
    `Salon de vote : <#${CANDIDATURE_LOG_CHANNEL_ID}>\n` +
    `Ticket : ${channel}`;

  for (const [, admin] of role.members) {
    await admin.send(text).catch(() => null);
  }
}

function scheduleCandidatureReminder(channel, member) {
  const existing = reminderTimeouts.get(channel.id);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(async () => {
    const ch = await channel.guild.channels.fetch(channel.id).catch(() => null);
    if (!ch?.topic?.startsWith("candidature:vote:")) return;
    if (ch.topic.includes(":closed") || ch.topic.includes(":reminded")) return;
    const m = await channel.guild.members.fetch(member.id).catch(() => null);
    if (m) await notifyAdminsPending(channel.guild, ch, m);
    await ch.setTopic(`${ch.topic}:reminded`).catch(() => null);
  }, THREE_DAYS_MS);

  reminderTimeouts.set(channel.id, timeout);
}

async function restoreCandidatureReminders(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.parentId !== CANDIDATURE_CATEGORY_ID) continue;
      if (channel.type !== ChannelType.GuildText) continue;
      if (!channel.topic?.startsWith("candidature:vote:")) continue;
      if (channel.topic.includes(":closed") || channel.topic.includes(":reminded"))
        continue;

      const parts = channel.topic.split(":");
      const memberId = parts[2];
      const completedAt = parseInt(parts[3], 10);
      if (!memberId || !completedAt) continue;

      const member = await guild.members.fetch(memberId).catch(() => null);
      if (!member) continue;

      const remaining = completedAt + THREE_DAYS_MS - Date.now();
      const run = async () => {
        const ch = await guild.channels.fetch(channel.id).catch(() => null);
        if (!ch || ch.topic?.includes(":reminded") || ch.topic?.includes(":closed"))
          return;
        await notifyAdminsPending(guild, ch, member);
        await ch.setTopic(`${ch.topic}:reminded`).catch(() => null);
      };

      if (remaining <= 0) await run();
      else reminderTimeouts.set(channel.id, setTimeout(run, remaining));
    }
  }
}

async function askNextQuestion(channel, member, index, answers) {
  const question = CANDIDATURE_QUESTIONS[index];
  const total = CANDIDATURE_QUESTIONS.length;

  const embed = new EmbedBuilder()
    .setColor(0x800020)
    .setTitle("📋 Candidature — Recrutement Maison")
    .setDescription(
      (index === 0
        ? "Merci de remplir ce formulaire **sérieusement**. Répondez à chaque question dans ce salon.\n\n"
        : "") +
        `**Question ${index + 1} / ${total}**\n\n${question.prompt}` +
        (question.optional ? "\n\n*Tapez `passer` pour ignorer.*" : "")
    );

  await channel.send({ embeds: [embed] });

  const collected = await channel
    .awaitMessages({
      filter: (m) => m.author.id === member.id && !m.author.bot,
      max: 1,
      time: QUESTION_TIMEOUT_MS,
      errors: ["time"],
    })
    .catch(() => null);

  if (!collected?.size) {
    await channel.send(
      "⏱️ Temps écoulé. Candidature annulée — vous pouvez rouvrir un ticket candidature."
    );
    activeSessions.delete(channel.id);
    return;
  }

  const msg = collected.first();
  let value = msg.content?.trim() || "";

  if (question.optional && ["passer", "skip", "-"].includes(value.toLowerCase())) {
    value = "Non renseigné";
  } else if (question.key === "photo" && msg.attachments.size > 0) {
    value = msg.attachments.first().url;
  } else if (!value && !question.optional) {
    await channel.send("❌ Réponse vide. Merci de répondre à la question.");
    return askNextQuestion(channel, member, index, answers);
  }

  answers[question.key] = value;

  if (index + 1 < total) {
    return askNextQuestion(channel, member, index + 1, answers);
  }

  return finishCandidature(channel, member, answers);
}

async function finishCandidature(channel, member, answers) {
  activeSessions.delete(channel.id);

  await channel.send("✅ Formulaire terminé — préparation de votre candidature…");
  await clearChannel(channel);

  await channel.send({ embeds: [buildWaitingEmbed()] });

  const stats = getVoteState(channel.id);
  stats.answers = answers;
  stats.memberId = member.id;
  stats.pour.clear();
  stats.contre.clear();
  stats.round = 1;
  stats.status = "voting";

  const completedAt = Date.now();
  await channel
    .setTopic(`candidature:vote:${member.id}:${completedAt}`)
    .catch(() => null);

  const logChannel = channel.guild.channels.cache.get(CANDIDATURE_LOG_CHANNEL_ID);
  if (logChannel?.isTextBased()) {
    const logEmbed = buildCandidatureResultEmbed(member, answers);
    logEmbed.setFooter({ text: "Votes anonymes — 2 votes requis pour statuer" });

    const logMsg = await logChannel.send({
      content: `<@&${ADMIN_VOTE_ROLE_ID}> — Nouvelle candidature à examiner`,
      embeds: [logEmbed],
      components: [buildVoteRow(channel.id)],
    });
    stats.logMessageId = logMsg.id;
  }

  scheduleCandidatureReminder(channel, member);
}

async function startCandidatureQuestionnaire(channel, member) {
  if (activeSessions.has(channel.id)) return;
  activeSessions.set(channel.id, { memberId: member.id });

  const intro = new EmbedBuilder()
    .setColor(0x800020)
    .setTitle("📋 Candidature — Recrutement Maison")
    .setDescription(
      "Merci de remplir ce formulaire **sérieusement** afin que le staff puisse étudier votre demande.\n\n" +
        "Les questions seront posées **une par une** dans ce salon.\n" +
        "Vous avez **30 minutes** par question.\n\n" +
        "*La conversation sera effacée à la fin — seul le récapitulatif sera conservé.*"
    );

  await channel.send({ content: `${member}`, embeds: [intro] });

  try {
    await askNextQuestion(channel, member, 0, {});
  } catch (err) {
    console.error("Erreur questionnaire candidature:", err.message);
    activeSessions.delete(channel.id);
    await channel.send("❌ Une erreur est survenue. Contactez le staff.");
  }
}

async function handleCandidatureVote(interaction) {
  const parsed = parseVoteCustomId(interaction.customId);
  if (!parsed) return false;

  const voter = interaction.member;
  const channelId = parsed.channelId;
  const channel = await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel?.topic?.startsWith("candidature:vote:")) {
    await interaction.reply({
      content: "❌ Cette candidature n'est plus active.",
      ephemeral: true,
    });
    return true;
  }

  if (channel.topic.includes(":closed")) {
    await interaction.reply({
      content: "❌ Cette candidature est déjà terminée.",
      ephemeral: true,
    });
    return true;
  }

  const stats = getVoteState(channelId);

  if (parsed.chef) {
    if (interaction.user.id !== CHEF_USER_ID) {
      await interaction.reply({
        content: "❌ Seule la cheffe peut trancher ce vote.",
        ephemeral: true,
      });
      return true;
    }
    if (stats.status !== "awaiting_chef") {
      await interaction.reply({
        content: "❌ Aucune décision cheffe en attente.",
        ephemeral: true,
      });
      return true;
    }

    const accepted = parsed.type === "pour";
    await interaction.reply({
      content: "👑 Décision enregistrée.",
      ephemeral: true,
    });

    const member = await interaction.guild.members
      .fetch(stats.memberId)
      .catch(() => null);
    if (member) {
      await finalizeCandidature(
        channel,
        interaction.guild,
        stats,
        accepted,
        "Décision de la cheffe."
      );
    }
    return true;
  }

  if (!voter?.roles.cache.has(ADMIN_VOTE_ROLE_ID)) {
    await interaction.reply({
      content: "❌ Seule l'administration peut voter.",
      ephemeral: true,
    });
    return true;
  }

  if (stats.status !== "voting" && stats.status !== "round2") {
    await interaction.reply({
      content: "❌ Le vote est fermé pour cette candidature.",
      ephemeral: true,
    });
    return true;
  }

  const userId = voter.id;
  if (stats.pour.has(userId) || stats.contre.has(userId)) {
    await interaction.reply({
      content: "🦋 Vous avez déjà voté.",
      ephemeral: true,
    });
    return true;
  }

  if (parsed.type === "pour") stats.pour.add(userId);
  else stats.contre.add(userId);

  await interaction.reply({
    content: "🦋 Vote enregistré. Merci.",
    ephemeral: true,
  });

  const member = await interaction.guild.members
    .fetch(stats.memberId)
    .catch(() => null);
  if (member) await evaluateVotes(channel, interaction.guild, stats, member);

  return true;
}

async function setupCandidatureCategoryPermissions(
  guild,
  welcomeRoleId,
  verifiedRoleId
) {
  const category = guild.channels.cache.get(CANDIDATURE_CATEGORY_ID);
  if (!category) return;

  const everyoneId = guild.roles.everyone.id;
  const denyView = { ViewChannel: false };

  await category.permissionOverwrites.edit(everyoneId, denyView).catch(() => null);
  await category.permissionOverwrites
    .edit(welcomeRoleId, denyView)
    .catch(() => null);
  await category.permissionOverwrites
    .edit(verifiedRoleId, denyView)
    .catch(() => null);
}

module.exports = {
  CANDIDATURE_CATEGORY_ID,
  CANDIDATURE_LOG_CHANNEL_ID,
  ADMIN_VOTE_ROLE_ID,
  isCandidatureCategory,
  startCandidatureQuestionnaire,
  handleCandidatureVote,
  setupCandidatureCategoryPermissions,
  restoreCandidatureReminders,
  activeSessions,
};
