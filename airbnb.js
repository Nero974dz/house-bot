const fs = require("fs");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  SlashCommandBuilder,
} = require("discord.js");
const { getStatePath, persistState } = require("./storage");
const { hasEnough, removeFunds, addFunds, formatEuro } = require("./bank");
const { logIrfEvent } = require("./irf-log");

const AIRBNB_CHANNEL_ID = "1527544352090357881";
const AIRBNB_CATEGORY_ID = "1527543462306648195";
const AIRBNB_TAX_RATE = 0.05; // taxe de séjour 5%
const STATE_FILE = getStatePath("airbnb-state.json");

// Boutons panel
const BTN_ADD    = "airbnb_add";
const BTN_LIST   = "airbnb_list";
const BTN_EDIT   = "airbnb_edit";
const BTN_RESA   = "airbnb_resa";
const BTN_CAL    = "airbnb_cal";
const BTN_REVENU = "airbnb_revenu";

// Modales
const MODAL_ADD            = "airbnb_modal_add";
const MODAL_RESA_PREFIX    = "airbnb_modal_resa_";    // + logId:locataireId
const MODAL_EDIT_PREFIX    = "airbnb_modal_edit_";    // + logId
const MODAL_DEGRAD_PREFIX  = "airbnb_modal_degrad_";  // + resaId
const MODAL_CAUTION_PREFIX = "airbnb_modal_caution_"; // + resaId

// Selects
const SELECT_LOG_RESA      = "airbnb_sel_log_resa";
const SELECT_LOC_RESA_PFX  = "airbnb_sel_loc_resa_"; // + logId
const SELECT_LOG_EDIT      = "airbnb_sel_log_edit";

// Boutons ticket
const CHECKIN_PREFIX        = "airbnb_checkin_";
const CHECKOUT_PREFIX       = "airbnb_checkout_";
const DEGRAD_PREFIX         = "airbnb_degrad_";
const CAUTION_FULL_PREFIX   = "airbnb_caut_full_";
const CAUTION_PART_PREFIX   = "airbnb_caut_part_";

function round2(n) { return Math.round(n * 100) / 100; }

// ---------- STATE ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { messageId: null, logements: {}, reservations: {} }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("airbnb-state.json");
}

// ---------- PANEL ----------
function buildPanelEmbed(state) {
  const logements = Object.values(state.logements);

  const desc = logements.length === 0
    ? "*Aucun logement enregistré. Ajoutez-en un avec ➕ !*"
    : logements.map(l => {
        const icon = l.statut === "libre" ? "🟢" : l.statut === "loue" ? "🔴" : "🧹";
        return `${icon} **${l.nom}** — ${formatEuro(l.prixNuit)}/nuit | Caution : ${formatEuro(l.caution)}\n  📍 *${l.adresse}*`;
      }).join("\n\n");

  const libres = logements.filter(l => l.statut === "libre").length;
  const loues  = logements.filter(l => l.statut === "loue").length;
  const menage = logements.filter(l => l.statut === "menage").length;

  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🏠 Agence Airbnb — Panel de gestion")
    .setDescription(desc)
    .addFields(
      { name: "🟢 Libres",     value: String(libres), inline: true },
      { name: "🔴 Loués",      value: String(loues),  inline: true },
      { name: "🧹 En ménage",  value: String(menage), inline: true },
    )
    .setFooter({ text: "🟢 Libre • 🔴 Loué • 🧹 En ménage après check-out" })
    .setTimestamp();
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_ADD).setLabel("Ajouter un logement").setEmoji("➕").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BTN_LIST).setLabel("Détail logements").setEmoji("📋").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_EDIT).setLabel("Modifier un logement").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_RESA).setLabel("Nouvelle réservation").setEmoji("📅").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_CAL).setLabel("Calendrier").setEmoji("📆").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BTN_REVENU).setLabel("Revenus & taxes").setEmoji("💰").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function updatePanel(client) {
  const channel = await client.channels.fetch(AIRBNB_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const state = loadState();
  const payload = { embeds: [buildPanelEmbed(state)], components: buildPanelComponents() };

  if (state.messageId) {
    const existing = await channel.messages.fetch(state.messageId).catch(() => null);
    if (existing) { await existing.edit(payload).catch(() => null); return; }
  }
  const msg = await channel.send(payload);
  state.messageId = msg.id;
  saveState(state);
}

async function setupAirbnbPanel(client) {
  await updatePanel(client);
  console.log("Panel Airbnb publié");
}

// ---------- EMBEDS TICKET ----------
function buildTicketEmbed(resa, logement) {
  const debut = new Date(resa.dateDebut).toLocaleDateString("fr-FR");
  const fin   = new Date(resa.dateFin).toLocaleDateString("fr-FR");
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🏠 Réservation — ${logement.nom}`)
    .addFields(
      { name: "📍 Adresse",       value: logement.adresse,                   inline: true },
      { name: "👤 Locataire",     value: `<@${resa.locataireId}>`,            inline: true },
      { name: "🎫 Gérant",        value: `<@${resa.gerantId}>`,              inline: true },
      { name: "📅 Arrivée",       value: debut,                               inline: true },
      { name: "📅 Départ",        value: fin,                                 inline: true },
      { name: "🌙 Nuits",         value: String(resa.nuits),                 inline: true },
      { name: "💶 Prix total",    value: formatEuro(resa.montant),           inline: true },
      { name: "🔐 Caution",       value: formatEuro(resa.caution),           inline: true },
      { name: "📊 Statut",        value: statusLabel(resa.statut),           inline: true },
    )
    .setFooter({ text: `Réf. ${resa.id}` })
    .setTimestamp();
}

function buildTicketComponents(resaId, statut) {
  const row = new ActionRowBuilder();
  if (statut === "confirmee") {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${CHECKIN_PREFIX}${resaId}`).setLabel("Check-in ✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${DEGRAD_PREFIX}${resaId}`).setLabel("Dégradation 💥").setStyle(ButtonStyle.Danger),
    );
  } else if (statut === "checkin") {
    row.addComponents(
      new ButtonBuilder().setCustomId(`${CHECKOUT_PREFIX}${resaId}`).setLabel("Check-out 🚪").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CAUTION_FULL_PREFIX}${resaId}`).setLabel("Rembourser caution 💰").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CAUTION_PART_PREFIX}${resaId}`).setLabel("Retenue caution 💥").setStyle(ButtonStyle.Danger),
    );
  }
  return row.components.length > 0 ? [row] : [];
}

function statusLabel(s) {
  return { confirmee: "✅ Confirmée", checkin: "🏠 En cours", checkout: "🚪 Check-out effectué", terminee: "🏁 Terminée" }[s] || s;
}

// ---------- HANDLER ----------
async function handleAirbnbInteraction(interaction, client) {
  const customId = interaction.customId || "";
  if (!customId.startsWith("airbnb_") && interaction.commandName !== "airbnb-setup") return false;

  // --- Commande setup ---
  if (interaction.isChatInputCommand() && interaction.commandName === "airbnb-setup") {
    await setupAirbnbPanel(client);
    await interaction.reply({ content: "✅ Panel Airbnb publié.", ephemeral: true });
    return true;
  }

  // ====== PANEL BOUTONS ======

  // --- ➕ Ajouter logement ---
  if (customId === BTN_ADD) {
    await interaction.showModal(
      new ModalBuilder().setCustomId(MODAL_ADD).setTitle("➕ Nouveau logement")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nom").setLabel("Nom du logement").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: Villa Rose")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("adresse").setLabel("Adresse RP").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 12 rue des Fleurs")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("prix").setLabel("Prix par nuit (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 150")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("caution").setLabel("Caution (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 300")),
        )
    );
    return true;
  }

  // --- Modal : ajouter logement ---
  if (interaction.isModalSubmit() && customId === MODAL_ADD) {
    const nom     = interaction.fields.getTextInputValue("nom").trim();
    const adresse = interaction.fields.getTextInputValue("adresse").trim();
    const prix    = parseFloat(interaction.fields.getTextInputValue("prix").replace(",", "."));
    const caution = parseFloat(interaction.fields.getTextInputValue("caution").replace(",", "."));

    if (isNaN(prix) || isNaN(caution) || prix <= 0 || caution < 0) {
      await interaction.reply({ content: "❌ Prix ou caution invalide.", ephemeral: true });
      return true;
    }

    const state = loadState();
    const id = `log_${Date.now()}`;
    state.logements[id] = { id, nom, adresse, prixNuit: prix, caution, statut: "libre", locataireId: null, reservationId: null };
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: `✅ **${nom}** ajouté au parc locatif.`, ephemeral: true });
    return true;
  }

  // --- 📋 Liste logements ---
  if (customId === BTN_LIST) {
    const state = loadState();
    const logements = Object.values(state.logements);
    if (logements.length === 0) {
      await interaction.reply({ content: "ℹ️ Aucun logement enregistré.", ephemeral: true });
      return true;
    }
    const lines = logements.map(l => {
      const icon = l.statut === "libre" ? "🟢" : l.statut === "loue" ? "🔴" : "🧹";
      const loc = l.locataireId ? ` — Locataire : <@${l.locataireId}>` : "";
      return `${icon} **${l.nom}** | ${formatEuro(l.prixNuit)}/nuit | Caution : ${formatEuro(l.caution)}\n  📍 *${l.adresse}*${loc}`;
    });
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📋 Logements").setDescription(lines.join("\n\n")).setTimestamp()],
      ephemeral: true,
    });
    return true;
  }

  // --- ✏️ Modifier logement ---
  if (customId === BTN_EDIT) {
    const state = loadState();
    const logements = Object.values(state.logements);
    if (logements.length === 0) {
      await interaction.reply({ content: "ℹ️ Aucun logement à modifier.", ephemeral: true });
      return true;
    }
    const options = logements.slice(0, 25).map(l => ({ label: l.nom, description: `${formatEuro(l.prixNuit)}/nuit — ${l.adresse}`, value: l.id }));
    await interaction.reply({
      content: "✏️ Quel logement souhaitez-vous modifier ?",
      components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(SELECT_LOG_EDIT).setPlaceholder("Sélectionner un logement").addOptions(options))],
      ephemeral: true,
    });
    return true;
  }

  // --- Select logement à modifier ---
  if (customId === SELECT_LOG_EDIT) {
    const logId = interaction.values[0];
    const state = loadState();
    const log = state.logements[logId];
    if (!log) { await interaction.update({ content: "❌ Logement introuvable.", components: [] }); return true; }
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${MODAL_EDIT_PREFIX}${logId}`).setTitle(`✏️ Modifier — ${log.nom}`)
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nom").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setRequired(true).setValue(log.nom)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("adresse").setLabel("Nouvelle adresse RP").setStyle(TextInputStyle.Short).setRequired(true).setValue(log.adresse)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("prix").setLabel("Nouveau prix/nuit (€)").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(log.prixNuit))),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("caution").setLabel("Nouvelle caution (€)").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(log.caution))),
        )
    );
    return true;
  }

  // --- Modal : modifier logement ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_EDIT_PREFIX)) {
    const logId   = customId.slice(MODAL_EDIT_PREFIX.length);
    const state   = loadState();
    if (!state.logements[logId]) { await interaction.reply({ content: "❌ Logement introuvable.", ephemeral: true }); return true; }
    const nom     = interaction.fields.getTextInputValue("nom").trim();
    const adresse = interaction.fields.getTextInputValue("adresse").trim();
    const prix    = parseFloat(interaction.fields.getTextInputValue("prix").replace(",", "."));
    const caution = parseFloat(interaction.fields.getTextInputValue("caution").replace(",", "."));
    if (isNaN(prix) || isNaN(caution)) { await interaction.reply({ content: "❌ Valeurs invalides.", ephemeral: true }); return true; }
    Object.assign(state.logements[logId], { nom, adresse, prixNuit: prix, caution });
    saveState(state);
    await updatePanel(client);
    await interaction.reply({ content: `✅ **${nom}** mis à jour.`, ephemeral: true });
    return true;
  }

  // --- 📅 Nouvelle réservation → choisir logement ---
  if (customId === BTN_RESA) {
    const state = loadState();
    const libres = Object.values(state.logements).filter(l => l.statut === "libre");
    if (libres.length === 0) {
      await interaction.reply({ content: "❌ Aucun logement disponible en ce moment.", ephemeral: true });
      return true;
    }
    const options = libres.slice(0, 25).map(l => ({ label: l.nom, description: `${formatEuro(l.prixNuit)}/nuit | Caution : ${formatEuro(l.caution)} | 📍 ${l.adresse}`, value: l.id }));
    await interaction.reply({
      content: "📅 Quel logement souhaitez-vous louer ?",
      components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(SELECT_LOG_RESA).setPlaceholder("Sélectionner un logement").addOptions(options))],
      ephemeral: true,
    });
    return true;
  }

  // --- Select logement → choisir locataire ---
  if (customId === SELECT_LOG_RESA) {
    const logId = interaction.values[0];
    await interaction.update({
      content: "👤 Sélectionnez le locataire :",
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${SELECT_LOC_RESA_PFX}${logId}`).setPlaceholder("Sélectionner le locataire"))],
    });
    return true;
  }

  // --- Select locataire → modal dates ---
  if (customId.startsWith(SELECT_LOC_RESA_PFX)) {
    const logId      = customId.slice(SELECT_LOC_RESA_PFX.length);
    const locataire  = interaction.users.first();
    if (!locataire) { await interaction.update({ content: "❌ Locataire invalide.", components: [] }); return true; }
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${MODAL_RESA_PREFIX}${logId}:${locataire.id}`).setTitle("📅 Détails de la réservation")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("debut").setLabel("Date d'arrivée (JJ/MM/AAAA)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 20/07/2026")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nuits").setLabel("Nombre de nuits").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 3")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("notes").setLabel("Notes (optionnel)").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Informations complémentaires...")),
        )
    );
    return true;
  }

  // --- Modal réservation → créer ticket ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_RESA_PREFIX)) {
    const [logId, locataireId] = customId.slice(MODAL_RESA_PREFIX.length).split(":");
    const debutStr = interaction.fields.getTextInputValue("debut").trim();
    const nuits    = parseInt(interaction.fields.getTextInputValue("nuits"), 10);
    const notes    = interaction.fields.getTextInputValue("notes")?.trim() || "";

    const state = loadState();
    const log   = state.logements[logId];
    if (!log || log.statut !== "libre") {
      await interaction.reply({ content: "❌ Ce logement n'est plus disponible.", ephemeral: true });
      return true;
    }
    if (isNaN(nuits) || nuits < 1) {
      await interaction.reply({ content: "❌ Nombre de nuits invalide.", ephemeral: true });
      return true;
    }

    // Calculer dates
    const [jour, mois, annee] = debutStr.split("/").map(Number);
    const dateDebut = new Date(annee, mois - 1, jour);
    if (isNaN(dateDebut.getTime())) {
      await interaction.reply({ content: "❌ Date invalide. Format attendu : JJ/MM/AAAA", ephemeral: true });
      return true;
    }
    const dateFin = new Date(dateDebut);
    dateFin.setDate(dateFin.getDate() + nuits);

    const montant = round2(log.prixNuit * nuits);
    const taxe    = round2(montant * AIRBNB_TAX_RATE);
    const total   = round2(montant + log.caution);

    // Vérifier solde locataire
    if (!hasEnough(locataireId, total)) {
      await interaction.reply({ content: `❌ <@${locataireId}> n'a pas les fonds suffisants (besoin de ${formatEuro(total)} — loyer + caution).`, ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    // Débiter locataire
    removeFunds(locataireId, total);
    addFunds(interaction.user.id, montant);

    // Créer réservation
    const resaId = `res_${Date.now()}`;
    const resa = {
      id: resaId, logementId: logId, locataireId,
      gerantId: interaction.user.id,
      dateDebut: dateDebut.getTime(), dateFin: dateFin.getTime(), nuits,
      montant, caution: log.caution, taxe,
      cautionRendue: false, statut: "confirmee", ticketId: null, notes, createdAt: Date.now(),
    };
    state.reservations[resaId] = resa;
    state.logements[logId].statut = "loue";
    state.logements[logId].locataireId = locataireId;
    state.logements[logId].reservationId = resaId;
    saveState(state);

    // Log IRF — revenus locatifs
    logIrfEvent({ userId: interaction.user.id, type: "🏠 Revenu locatif", game: log.nom, amount: montant, byId: interaction.user.id });
    logIrfEvent({ userId: "treasury", type: "🏛️ Argent Taxe", game: `séjour ${log.nom}`, amount: taxe, byId: interaction.user.id });

    // Créer ticket
    const category = await client.channels.fetch(AIRBNB_CATEGORY_ID).catch(() => null);
    const ticket = await interaction.guild.channels.create({
      name: `resa-${log.nom.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}-${Date.now().toString().slice(-4)}`,
      parent: category?.id || null,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: ["ViewChannel"] },
        { id: locataireId,          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: interaction.user.id,  allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    }).catch(() => null);

    if (ticket) {
      resa.ticketId = ticket.id;
      state.reservations[resaId] = resa;
      saveState(state);

      const notesField = notes ? `\n\n📝 *${notes}*` : "";
      await ticket.send({
        content: `<@${locataireId}> <@${interaction.user.id}>`,
        embeds: [buildTicketEmbed(resa, log).setDescription(
          `**Loyer :** ${formatEuro(montant)} débité\n**Caution :** ${formatEuro(log.caution)} bloquée\n**Taxe de séjour :** ${formatEuro(taxe)}${notesField}`
        )],
        components: buildTicketComponents(resaId, "confirmee"),
      });
    }

    await updatePanel(client);
    await interaction.editReply({ content: `✅ Réservation créée ! Ticket : ${ticket || "introuvable"}.\n💶 **${formatEuro(total)}** débités de <@${locataireId}> (loyer + caution).` });
    return true;
  }

  // --- 📆 Calendrier ---
  if (customId === BTN_CAL) {
    const state = loadState();
    const resas = Object.values(state.reservations).filter(r => r.statut !== "terminee");
    if (resas.length === 0) {
      await interaction.reply({ content: "📆 Aucune réservation en cours ou à venir.", ephemeral: true });
      return true;
    }
    const lines = resas.map(r => {
      const log   = state.logements[r.logementId];
      const debut = new Date(r.dateDebut).toLocaleDateString("fr-FR");
      const fin   = new Date(r.dateFin).toLocaleDateString("fr-FR");
      return `**${log?.nom || "Logement inconnu"}** — <@${r.locataireId}>\n  ${debut} → ${fin} (${r.nuits} nuit${r.nuits > 1 ? "s" : ""}) | ${statusLabel(r.statut)}`;
    });
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("📆 Calendrier des réservations").setDescription(lines.join("\n\n")).setTimestamp()],
      ephemeral: true,
    });
    return true;
  }

  // --- 💰 Revenus & taxes ---
  if (customId === BTN_REVENU) {
    const state = loadState();
    const resas = Object.values(state.reservations);
    const terminees = resas.filter(r => r.statut === "terminee" || r.statut === "checkout");
    const totalRevenu = round2(terminees.reduce((s, r) => s + r.montant, 0));
    const totalTaxes  = round2(terminees.reduce((s, r) => s + r.taxe, 0));
    const nbResas     = resas.length;
    const nbActives   = resas.filter(r => r.statut === "checkin" || r.statut === "confirmee").length;

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("💰 Revenus & Taxes Airbnb")
        .addFields(
          { name: "📊 Réservations totales", value: String(nbResas), inline: true },
          { name: "🏠 En cours",             value: String(nbActives), inline: true },
          { name: "✅ Terminées",             value: String(terminees.length), inline: true },
          { name: "💶 Revenus locatifs",     value: formatEuro(totalRevenu), inline: true },
          { name: "🏛️ Taxes de séjour (5%)", value: formatEuro(totalTaxes), inline: true },
        )
        .setTimestamp()
      ],
      ephemeral: true,
    });
    return true;
  }

  // ====== BOUTONS TICKET ======

  // --- ✅ Check-in ---
  if (customId.startsWith(CHECKIN_PREFIX)) {
    const resaId = customId.slice(CHECKIN_PREFIX.length);
    const state  = loadState();
    const resa   = state.reservations[resaId];
    if (!resa) { await interaction.reply({ content: "❌ Réservation introuvable.", ephemeral: true }); return true; }
    if (resa.statut !== "confirmee") { await interaction.reply({ content: "❌ Check-in déjà effectué.", ephemeral: true }); return true; }

    resa.statut = "checkin";
    resa.checkinAt = Date.now();
    state.reservations[resaId] = resa;
    saveState(state);

    const log = state.logements[resa.logementId];
    const embed = buildTicketEmbed(resa, log)
      .setColor(0x2ecc71)
      .setDescription("✅ **Check-in effectué.** Le locataire est dans les lieux.");

    await interaction.update({ embeds: [embed], components: buildTicketComponents(resaId, "checkin") });

    // DM locataire
    const user = await client.users.fetch(resa.locataireId).catch(() => null);
    if (user) await user.send(`✅ Votre check-in au **${log?.nom}** a été enregistré. Bon séjour !`).catch(() => null);
    return true;
  }

  // --- 🚪 Check-out ---
  if (customId.startsWith(CHECKOUT_PREFIX)) {
    const resaId = customId.slice(CHECKOUT_PREFIX.length);
    const state  = loadState();
    const resa   = state.reservations[resaId];
    if (!resa) { await interaction.reply({ content: "❌ Réservation introuvable.", ephemeral: true }); return true; }

    resa.statut = "checkout";
    resa.checkoutAt = Date.now();
    state.reservations[resaId] = resa;
    const log = state.logements[resa.logementId];
    if (log) { log.statut = "menage"; log.locataireId = null; log.reservationId = null; }
    saveState(state);
    await updatePanel(client);

    const embed = buildTicketEmbed(resa, log)
      .setColor(0xe67e22)
      .setDescription("🚪 **Check-out effectué.** Le logement est en cours de ménage.\n\nRemboursez la caution si tout est en ordre, ou appliquez une retenue.");

    await interaction.update({ embeds: [embed], components: buildTicketComponents(resaId, "checkin") });
    return true;
  }

  // --- 💰 Rembourser caution complète ---
  if (customId.startsWith(CAUTION_FULL_PREFIX)) {
    const resaId = customId.slice(CAUTION_FULL_PREFIX.length);
    const state  = loadState();
    const resa   = state.reservations[resaId];
    if (!resa || resa.cautionRendue) { await interaction.reply({ content: "❌ Caution déjà traitée.", ephemeral: true }); return true; }

    addFunds(resa.locataireId, resa.caution);
    resa.cautionRendue = true;
    resa.statut = "terminee";
    if (state.logements[resa.logementId]) state.logements[resa.logementId].statut = "libre";
    saveState(state);
    await updatePanel(client);

    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("💰 Caution remboursée")
      .setDescription(`La caution de **${formatEuro(resa.caution)}** a été remboursée à <@${resa.locataireId}>.\nLe logement est de nouveau disponible.`)
      .setTimestamp();
    await interaction.update({ embeds: [embed], components: [] });

    const user = await client.users.fetch(resa.locataireId).catch(() => null);
    if (user) await user.send(`💰 Votre caution de **${formatEuro(resa.caution)}** vous a été remboursée. Merci pour votre séjour !`).catch(() => null);

    setTimeout(() => interaction.channel?.delete().catch(() => null), 10000);
    return true;
  }

  // --- 💥 Retenue caution partielle → modal ---
  if (customId.startsWith(CAUTION_PART_PREFIX)) {
    const resaId = customId.slice(CAUTION_PART_PREFIX.length);
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${MODAL_CAUTION_PREFIX}${resaId}`).setTitle("💥 Retenue sur caution")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("montant").setLabel("Montant retenu (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 150")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("motif").setLabel("Motif (dégradation, etc.)").setStyle(TextInputStyle.Paragraph).setRequired(true)),
        )
    );
    return true;
  }

  // --- Modal retenue caution ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_CAUTION_PREFIX)) {
    const resaId  = customId.slice(MODAL_CAUTION_PREFIX.length);
    const state   = loadState();
    const resa    = state.reservations[resaId];
    if (!resa || resa.cautionRendue) { await interaction.reply({ content: "❌ Caution déjà traitée.", ephemeral: true }); return true; }

    const retenu  = Math.min(parseFloat(interaction.fields.getTextInputValue("montant").replace(",", ".")), resa.caution);
    const motif   = interaction.fields.getTextInputValue("motif");
    const rembourse = round2(resa.caution - retenu);

    if (isNaN(retenu) || retenu < 0) { await interaction.reply({ content: "❌ Montant invalide.", ephemeral: true }); return true; }

    if (rembourse > 0) addFunds(resa.locataireId, rembourse);
    addFunds(resa.gerantId, retenu);

    resa.cautionRendue = true;
    resa.statut = "terminee";
    if (state.logements[resa.logementId]) state.logements[resa.logementId].statut = "libre";
    saveState(state);
    await updatePanel(client);

    const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle("💥 Retenue sur caution")
      .addFields(
        { name: "Caution totale",    value: formatEuro(resa.caution), inline: true },
        { name: "Montant retenu",    value: formatEuro(retenu),       inline: true },
        { name: "Remboursé",         value: formatEuro(rembourse),    inline: true },
        { name: "Motif",             value: motif },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });

    const user = await client.users.fetch(resa.locataireId).catch(() => null);
    if (user) await user.send(`⚠️ Une retenue de **${formatEuro(retenu)}** a été appliquée sur votre caution.\nMotif : *${motif}*\nRemboursé : **${formatEuro(rembourse)}**`).catch(() => null);

    setTimeout(() => interaction.channel?.delete().catch(() => null), 15000);
    return true;
  }

  // --- 💥 Signaler dégradation (depuis ticket en checkin) ---
  if (customId.startsWith(DEGRAD_PREFIX)) {
    const resaId = customId.slice(DEGRAD_PREFIX.length);
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${MODAL_DEGRAD_PREFIX}${resaId}`).setTitle("💥 Signalement de dégradation")
        .addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("desc").setLabel("Description des dégâts").setStyle(TextInputStyle.Paragraph).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("montant").setLabel("Estimation du coût (€)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("ex: 200")),
        )
    );
    return true;
  }

  // --- Modal dégradation ---
  if (interaction.isModalSubmit() && customId.startsWith(MODAL_DEGRAD_PREFIX)) {
    const resaId = customId.slice(MODAL_DEGRAD_PREFIX.length);
    const state  = loadState();
    const resa   = state.reservations[resaId];
    const desc   = interaction.fields.getTextInputValue("desc");
    const cout   = parseFloat(interaction.fields.getTextInputValue("montant").replace(",", "."));
    const log    = resa ? state.logements[resa.logementId] : null;

    const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle("💥 Dégradation signalée")
      .addFields(
        { name: "🏠 Logement",   value: log?.nom || "Inconnu", inline: true },
        { name: "👤 Locataire",  value: `<@${resa?.locataireId}>`, inline: true },
        { name: "💶 Estimation", value: isNaN(cout) ? "Non précisé" : formatEuro(cout), inline: true },
        { name: "📝 Description", value: desc },
      )
      .setFooter({ text: `Signalé par ${interaction.user.username}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return true;
  }

  return false;
}

function registerAirbnbSetupCommand() {
  return new SlashCommandBuilder()
    .setName("airbnb-setup")
    .setDescription("Publier le panel Airbnb")
    .toJSON();
}

module.exports = { setupAirbnbPanel, handleAirbnbInteraction, registerAirbnbSetupCommand };
