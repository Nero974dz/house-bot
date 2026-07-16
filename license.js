const fs = require("fs");
const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const {
  hasEnough,
  removeFunds,
  addFunds,
  collectTax,
  formatEuro,
  logTransaction,
} = require("./bank");

const LICENSE_ROLE_ID = "1527364017583030503";
const FONDATION_ROLE_ID = "1509974377267990659";
const LICENSE_PRICE = 1000;

const STATE_FILE = getStatePath("license-state.json");

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!data.holders || typeof data.holders !== "object") data.holders = {};
    return data;
  } catch {
    return { holders: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("license-state.json");
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

/** Découpe une liste de mentions pour tenir dans un champ d'embed (1024 max). */
function formatMemberList(members) {
  if (!members.length) return "*Aucun*";
  const text = members.map((m) => `${m}`).join(", ");
  if (text.length <= 1000) return text;
  // trop long : on tronque proprement
  let out = "";
  let count = 0;
  for (const m of members) {
    const piece = `${m}, `;
    if (out.length + piece.length > 950) break;
    out += piece;
    count++;
  }
  return `${out.slice(0, -2)}\n*… et ${members.length - count} autre(s)*`;
}

async function handleLicenseInteraction(interaction, client) {
  // --- Achat de la licence ---
  if (interaction.isChatInputCommand() && interaction.commandName === "license") {
    const state = loadState();
    const userId = interaction.user.id;

    if (state.holders[userId] || interaction.member?.roles.cache.has(LICENSE_ROLE_ID)) {
      const paidAt = state.holders[userId]?.paidAt;
      await interaction.reply({
        content:
          "ℹ️ Vous possédez déjà la licence." +
          (paidAt ? ` (achetée le ${formatDateTime(paidAt)})` : ""),
        ephemeral: true,
      });
      return true;
    }

    const role = interaction.guild.roles.cache.get(LICENSE_ROLE_ID);
    if (!role) {
      await interaction.reply({
        content: "❌ Le rôle de licence est introuvable. Contactez un admin.",
        ephemeral: true,
      });
      return true;
    }

    if (!hasEnough(userId, LICENSE_PRICE)) {
      await interaction.reply({
        content: `❌ Solde insuffisant : la licence coûte **${formatEuro(LICENSE_PRICE)}**. Vérifiez votre solde avec \`/bank\`.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    removeFunds(userId, LICENSE_PRICE);

    try {
      await interaction.member.roles.add(role);
    } catch (err) {
      console.error("Erreur attribution rôle licence:", err.message);
      addFunds(userId, LICENSE_PRICE); // remboursement
      await interaction.editReply({
        content:
          "❌ Impossible de vous attribuer le rôle (permissions du bot ?). Vous avez été remboursé, contactez un admin.",
      });
      return true;
    }

    collectTax(LICENSE_PRICE); // la totalité va à la Banque de la Maison
    state.holders[userId] = { paidAt: Date.now(), amount: LICENSE_PRICE };
    saveState(state);

    await logTransaction(client, {
      type: "📜 Achat de licence (/license)",
      from: userId,
      gross: LICENSE_PRICE,
      tax: LICENSE_PRICE,
      net: 0,
    });

    await interaction.editReply({
      content:
        `✅ Licence achetée pour **${formatEuro(LICENSE_PRICE)}** !\n` +
        `Le rôle ${role} vous a été attribué.`,
    });
    return true;
  }

  // --- Tableau des licences (admins) ---
  if (interaction.isChatInputCommand() && interaction.commandName === "tablicense") {
    if (!isFondation(interaction.member)) {
      await interaction.reply({
        content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut consulter le tableau des licences.`,
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    await interaction.guild.members.fetch().catch(() => null);

    const state = loadState();
    const withLicense = [];
    const withoutLicense = [];

    for (const member of interaction.guild.members.cache.values()) {
      if (member.user.bot) continue;
      if (state.holders[member.id] || member.roles.cache.has(LICENSE_ROLE_ID)) {
        withLicense.push(member);
      } else {
        withoutLicense.push(member);
      }
    }

    const total = withLicense.length + withoutLicense.length;
    const revenue = withLicense.reduce(
      (sum, m) => sum + (state.holders[m.id]?.amount || 0),
      0
    );

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📜 Tableau des licences")
      .setDescription(
        `**${withLicense.length}** membre(s) sur **${total}** possèdent la licence.\n` +
          `Prix : **${formatEuro(LICENSE_PRICE)}** • Recettes enregistrées : **${formatEuro(revenue)}**`
      )
      .addFields(
        {
          name: `✅ Avec licence (${withLicense.length})`,
          value: formatMemberList(withLicense),
        },
        {
          name: `❌ Sans licence (${withoutLicense.length})`,
          value: formatMemberList(withoutLicense),
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  return false;
}

function registerLicenseCommand() {
  return new SlashCommandBuilder()
    .setName("license")
    .setDescription(`Acheter la licence (${LICENSE_PRICE} €, payée avec votre solde /bank)`)
    .toJSON();
}

function registerTabLicenseCommand() {
  return new SlashCommandBuilder()
    .setName("tablicense")
    .setDescription("Voir qui a payé la licence (Fondation uniquement)")
    .toJSON();
}

module.exports = {
  handleLicenseInteraction,
  registerLicenseCommand,
  registerTabLicenseCommand,
  LICENSE_ROLE_ID,
  LICENSE_PRICE,
};
