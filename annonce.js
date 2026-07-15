const {
  EmbedBuilder,
} = require("discord.js");

const ANNOUNCE_CHANNEL_ID = "1509983723892903966";
const ANNOUNCE_TITLE_MARKER = "Une nouvelle ère";

const PANEL_LINKS = {
  boutique: "1510771583348641902",
  tickets: "1509976660966117537",
};

function buildReopeningEmbed(guild) {
  const name = guild?.name ?? "la Maison";

  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(`🦋 ${name} — ${ANNOUNCE_TITLE_MARKER} 🦋`)
    .setDescription(
      "♡ ••••• ♡\n\n" +
        "*La Maison se réveille. Après une pause, nous rouvrons nos portes et entrons dans une **nouvelle ère** — " +
        "plus organisée, plus accueillante, plus vivante.*\n\n" +
        "Le bot **House** accompagne désormais votre quotidien : économie, missions, boutique, progression… " +
        "Tout est pensé pour que chaque membre sache **où aller** et **quoi utiliser**.\n\n" +
        "━━━━━━━━━━━━━━━━━━━━"
    )
    .addFields(
      {
        name: "⌨️ Nouvelles commandes",
        value:
          "`/crédit` — Demander un crédit argent\n" +
          "`/achat` — Demande d'achat d'un produit\n" +
          "`/report` — Signalement anonyme d'un membre",
      },
      {
        name: "📌 Salons & panels à connaître",
        value:
          `🛍️ **Boutique** — <#${PANEL_LINKS.boutique}> *(achats sécurisés middleman)*\n` +
          `🎫 **Tickets** — <#${PANEL_LINKS.tickets}> *(question, candidature, report…)*`,
      },
      {
        name: "✨ Ce qui vous attend",
        value:
          "• Candidatures guidées pas à pas, avec votes du staff\n" +
          "• Budget maison, chambres, repas du jour, hiérarchie à jour\n" +
          "• Signalements anonymes et boutique avec middleman\n\n" +
          "*Prenez le temps de parcourir les salons, d'accepter le règlement si ce n'est pas déjà fait, " +
          "et de poser vos questions en ticket si besoin.*",
      }
    )
    .setFooter({
      text: "Bienvenue dans la nouvelle ère — avec respect, entraide et ambition",
    })
    .setTimestamp();
}

async function setupReopeningAnnouncement(client) {
  const channel = await client.channels
    .fetch(ANNOUNCE_CHANNEL_ID)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    console.warn(`Salon annonce ${ANNOUNCE_CHANNEL_ID} introuvable`);
    return;
  }

  const guild = channel.guild;
  const embed = buildReopeningEmbed(guild);

  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existing = messages?.find(
    (m) =>
      m.author.id === client.user.id &&
      m.embeds[0]?.title?.includes(ANNOUNCE_TITLE_MARKER)
  );

  const mentionEveryone = {
    content: "@everyone",
    allowedMentions: { parse: ["everyone"] },
  };

  if (existing) {
    await existing.edit({ embeds: [embed] });
    console.log("Annonce nouvelle ère mise à jour (sans nouveau ping)");
  } else {
    await channel.send({
      ...mentionEveryone,
      embeds: [embed],
    });
    console.log("Annonce nouvelle ère publiée avec @everyone");
  }
}

module.exports = {
  setupReopeningAnnouncement,
  ANNOUNCE_CHANNEL_ID,
};
