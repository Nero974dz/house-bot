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
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const SHOP_CHANNEL_ID = "1510771583348641902";
const SELLER_ROLE_ID = "1510771827931086879";
const SHOP_TICKET_CATEGORY_ID = "1510692131487092736";
const MIDDLEMAN_ROLE_ID = "1510773230154289222";
const SHOP_LOG_CHANNEL_ID = "1510687492896981102";

const STATE_FILE = getStatePath("boutique-state.json");

const BTN = {
  SELL: "shop_sell",
  REMOVE: "shop_remove",
  REFRESH: "shop_refresh",
};
const MODAL = { SELL: "shop_sell_modal" };
const SELECT = {
  ITEM: "shop_select_item",
  REMOVE: "shop_remove_select",
};
const BUY_PREFIX = "shop_buy_";
const ACCEPT_PREFIX = "shop_accept_";
const REFUSE_PREFIX = "shop_refuse_";
const TRADE_BUYER_PREFIX = "shop_trade_buyer_";
const TRADE_SELLER_PREFIX = "shop_trade_seller_";

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!Array.isArray(data.items)) data.items = [];
    if (!data.pending) data.pending = {};
    if (!data.trades) data.trades = {};
    return data;
  } catch {
    return { messageId: null, items: [], pending: {}, trades: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  persistState("boutique-state.json");
}

function isSeller(member) {
  return member?.roles.cache.has(SELLER_ROLE_ID) ?? false;
}

function slugify(text) {
  return (
    (text || "vente")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 20) || "vente"
  );
}

function getItem(state, itemId) {
  return state.items.find((i) => i.id === itemId);
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

function buildShopEmbed(state) {
  const count = state.items.length;
  const preview = state.items.slice(0, 5);

  let listing =
    preview.length > 0
      ? preview
          .map(
            (item) =>
              `💋 • **${item.name}** — ${item.price} €\n` +
              `   └ *par <@${item.sellerId}>*`
          )
          .join("\n\n")
      : "*Aucun article en vente pour le moment.*";

  if (state.items.length > 5) {
    listing += `\n\n*… et ${state.items.length - 5} autre(s) article(s)*`;
  }

  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle("🦋 • BOUTIQUE MAISON • 🦋")
    .setDescription(
      "♡ ••••• ♡\n\n" +
        "*Bienvenue dans la boutique de la Maison.*\n" +
        "Parcourez les articles — achat sécurisé via **middleman**.\n\n" +
        `⤷ **${count}** article(s) disponible(s)\n\n` +
        listing
    )
    .setFooter({
      text: "Vendeurs : rôle boutique • Transaction sécurisée middleman",
    })
    .setTimestamp();
}

function buildShopComponents(state) {
  const rows = [];

  if (state.items.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(SELECT.ITEM)
          .setPlaceholder("🛍️ Choisir un article à consulter")
          .addOptions(
            state.items.slice(0, 25).map((item) => ({
              label: item.name.slice(0, 100),
              value: item.id,
              description: `${item.price} €`.slice(0, 100),
              emoji: "🦋",
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BTN.SELL)
        .setLabel("Mettre en vente")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(BTN.REMOVE)
        .setLabel("Retirer mon article")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(BTN.REFRESH)
        .setLabel("Actualiser")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return rows;
}

function buildSellModal() {
  return new ModalBuilder()
    .setCustomId(MODAL.SELL)
    .setTitle("🦋 Mettre un article en vente")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("nom")
          .setLabel("Nom de l'article")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("prix")
          .setLabel("Prix (€)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function buildItemDetailEmbed(item, guild) {
  const seller = guild.members.cache.get(item.sellerId);
  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(`🛍️ ${item.name}`)
    .setDescription(item.description)
    .addFields(
      { name: "💶 Prix", value: `**${item.price} €**`, inline: true },
      {
        name: "👤 Vendeur",
        value: seller ? `${seller}` : `<@${item.sellerId}>`,
        inline: true,
      }
    )
    .setFooter({ text: `Réf. ${item.id}` })
    .setTimestamp(new Date(item.createdAt));
}

function buildRemoveSelect(state, sellerId) {
  const mine = state.items.filter((i) => i.sellerId === sellerId);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.REMOVE)
      .setPlaceholder("Article à retirer")
      .addOptions(
        mine.map((item) => ({
          label: item.name.slice(0, 100),
          value: item.id,
          description: `${item.price} €`.slice(0, 100),
        }))
      )
  );
}

function buildSellerRequestEmbed(item, buyer, requestId) {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("🛒 Demande d'achat")
    .setDescription(
      `${buyer} souhaite acheter votre article.\n\n` +
        `**Article :** ${item.name}\n` +
        `**Prix :** ${item.price} €\n` +
        `**Description :** ${item.description}\n\n` +
        `Acceptez pour ouvrir un ticket **middleman** sécurisé.`
    )
    .setFooter({ text: `Demande ${requestId}` })
    .setTimestamp();
}

function buildSellerRequestRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ACCEPT_PREFIX}${requestId}`)
      .setLabel("Accepter la vente")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${REFUSE_PREFIX}${requestId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildTradeIntroEmbed(trade) {
  const statusBuyer = trade.buyerConfirmed ? "✅ Confirmé" : "⏳ En attente";
  const statusSeller = trade.sellerConfirmed ? "✅ Confirmé" : "⏳ En attente";

  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle("🦋 Transaction Middleman")
    .setDescription(
      `<@${trade.buyerId}> ↔ <@${trade.sellerId}>\n\n` +
        `**Article :** ${trade.item.name}\n` +
        `**Prix :** ${trade.item.price} €\n` +
        `**Description :** ${trade.item.description}\n\n` +
        `📋 **Étapes :**\n` +
        `1️⃣ L'**acheteur** remet l'**argent** au middleman <@&${MIDDLEMAN_ROLE_ID}>\n` +
        `2️⃣ Le **vendeur** remet l'**article** au middleman\n` +
        `3️⃣ Chacun **confirme** ci-dessous une fois l'étape effectuée\n` +
        `4️⃣ Le ticket se ferme automatiquement quand les deux ont validé\n\n` +
        `💶 Acheteur : ${statusBuyer}\n` +
        `📦 Vendeur : ${statusSeller}`
    )
    .setTimestamp();
}

function buildTradeConfirmRow(tradeId, trade) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TRADE_BUYER_PREFIX}${tradeId}`)
      .setLabel("J'ai donné l'argent")
      .setEmoji("💶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(trade.buyerConfirmed),
    new ButtonBuilder()
      .setCustomId(`${TRADE_SELLER_PREFIX}${tradeId}`)
      .setLabel("J'ai donné l'article")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(trade.sellerConfirmed)
  );
}

function buildTradeLogEmbed(trade, guild) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Vente boutique terminée")
    .addFields(
      { name: "Article", value: trade.item.name },
      { name: "Prix", value: `${trade.item.price} €`, inline: true },
      {
        name: "Acheteur",
        value: `<@${trade.buyerId}>`,
        inline: true,
      },
      {
        name: "Vendeur",
        value: `<@${trade.sellerId}>`,
        inline: true,
      },
      {
        name: "Ouvert le",
        value: formatDateTime(trade.createdAt),
        inline: true,
      },
      {
        name: "Clôturé le",
        value: formatDateTime(trade.closedAt),
        inline: true,
      }
    )
    .setTimestamp(new Date(trade.closedAt));
}

async function updateShopPanel(client) {
  const channel = await client.channels.fetch(SHOP_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const state = loadState();
  const embed = buildShopEmbed(state);
  const components = buildShopComponents(state);

  let msg = null;
  if (state.messageId) {
    msg = await channel.messages.fetch(state.messageId).catch(() => null);
  }
  if (!msg) {
    const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    msg = messages?.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds[0]?.title?.includes("BOUTIQUE MAISON")
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

async function setupShopPanel(client) {
  await updateShopPanel(client);
  console.log("Boutique publiée");
}

async function createTradeTicket(guild, client, trade, tradeId) {
  const buyer = await guild.members.fetch(trade.buyerId).catch(() => null);
  const seller = await guild.members.fetch(trade.sellerId).catch(() => null);
  if (!buyer || !seller) throw new Error("Membres introuvables");

  const channelName = `vente-${slugify(trade.item.name)}`.slice(0, 100);

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: trade.buyerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: trade.sellerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: MIDDLEMAN_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
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
    parent: SHOP_TICKET_CATEGORY_ID,
    topic: `shop_trade:${tradeId}`,
    permissionOverwrites,
  });

  trade.channelId = ticketChannel.id;
  trade.status = "open";

  const intro = buildTradeIntroEmbed(trade);
  await ticketChannel.send({
    content: `<@${trade.buyerId}> <@${trade.sellerId}> <@&${MIDDLEMAN_ROLE_ID}>`,
    embeds: [intro],
    components: [buildTradeConfirmRow(tradeId, trade)],
  });

  return ticketChannel;
}

async function closeTrade(guild, client, tradeId, state) {
  const trade = state.trades[tradeId];
  if (!trade || trade.status === "closed") return;

  trade.status = "closed";
  trade.closedAt = Date.now();
  saveState(state);

  const logChannel = await guild.channels.fetch(SHOP_LOG_CHANNEL_ID).catch(() => null);
  if (logChannel?.isTextBased()) {
    await logChannel.send({ embeds: [buildTradeLogEmbed(trade, guild)] });
  }

  const channel = await guild.channels.fetch(trade.channelId).catch(() => null);
  if (channel) {
    await channel.send("✅ **Transaction terminée** — fermeture du ticket dans 5 secondes…");
    setTimeout(() => channel.delete("Vente terminée").catch(() => null), 5000);
  }

  try {
    await guild.members.fetch(trade.buyerId).then((m) =>
      m.send(`✅ Votre achat **${trade.item.name}** est terminé. Merci !`).catch(() => null)
    );
    await guild.members.fetch(trade.sellerId).then((m) =>
      m.send(`✅ Vente de **${trade.item.name}** terminée. Merci !`).catch(() => null)
    );
  } catch {
    /* ignore */
  }
}

async function updateTradeMessage(guild, tradeId, state) {
  const trade = state.trades[tradeId];
  if (!trade?.channelId) return;

  const channel = await guild.channels.fetch(trade.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  const botMsg = messages?.find(
    (m) =>
      m.author.id === guild.client.user.id &&
      m.embeds[0]?.title === "🦋 Transaction Middleman"
  );

  if (botMsg) {
    await botMsg.edit({
      embeds: [buildTradeIntroEmbed(trade)],
      components: [buildTradeConfirmRow(tradeId, trade)],
    });
  }
}

function denySeller(interaction) {
  return interaction.reply({
    content: `❌ Seuls les membres avec le rôle <@&${SELLER_ROLE_ID}> peuvent vendre.`,
    ephemeral: true,
  });
}

async function handleShopInteraction(interaction, client) {
  const id = interaction.customId ?? "";

  const isShop =
    (interaction.isModalSubmit() && interaction.customId === MODAL.SELL) ||
    (interaction.isStringSelectMenu() &&
      (id === SELECT.ITEM || id === SELECT.REMOVE)) ||
    (interaction.isButton() &&
      (Object.values(BTN).includes(id) ||
        id.startsWith(BUY_PREFIX) ||
        id.startsWith(ACCEPT_PREFIX) ||
        id.startsWith(REFUSE_PREFIX) ||
        id.startsWith(TRADE_BUYER_PREFIX) ||
        id.startsWith(TRADE_SELLER_PREFIX)));

  if (!isShop) return false;

  // --- Panel boutique ---
  if (interaction.isButton() && interaction.customId === BTN.SELL) {
    if (!isSeller(interaction.member)) {
      await denySeller(interaction);
      return true;
    }
    await interaction.showModal(buildSellModal());
    return true;
  }

  if (interaction.isButton() && interaction.customId === BTN.REMOVE) {
    if (!isSeller(interaction.member)) {
      await denySeller(interaction);
      return true;
    }
    const state = loadState();
    const mine = state.items.filter((i) => i.sellerId === interaction.user.id);
    if (!mine.length) {
      await interaction.reply({
        content: "ℹ️ Vous n'avez aucun article en vente.",
        ephemeral: true,
      });
      return true;
    }
    await interaction.reply({
      content: "🗑️ Sélectionnez l'article à retirer :",
      components: [buildRemoveSelect(state, interaction.user.id)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === BTN.REFRESH) {
    await updateShopPanel(client);
    await interaction.reply({
      content: "🔄 Boutique actualisée.",
      ephemeral: true,
    });
    return true;
  }

  // --- Achat : demande au vendeur ---
  if (interaction.isButton() && interaction.customId.startsWith(BUY_PREFIX)) {
    const itemId = interaction.customId.slice(BUY_PREFIX.length);
    const state = loadState();
    const item = getItem(state, itemId);

    if (!item) {
      await interaction.reply({
        content: "❌ Cet article n'est plus disponible.",
        ephemeral: true,
      });
      return true;
    }

    if (item.sellerId === interaction.user.id) {
      await interaction.reply({
        content: "❌ Vous ne pouvez pas acheter votre propre article.",
        ephemeral: true,
      });
      return true;
    }

    const requestId = `req_${Date.now()}`;
    state.pending[requestId] = {
      itemId,
      buyerId: interaction.user.id,
      sellerId: item.sellerId,
      guildId: interaction.guild.id,
      itemSnapshot: { ...item },
      createdAt: Date.now(),
    };
    saveState(state);

    const seller = await interaction.guild.members
      .fetch(item.sellerId)
      .catch(() => null);

    const requestEmbed = buildSellerRequestEmbed(
      item,
      interaction.member,
      requestId
    );
    const requestRow = buildSellerRequestRow(requestId);

    if (seller) {
      await seller
        .send({ embeds: [requestEmbed], components: [requestRow] })
        .catch(async () => {
          await interaction.channel.send({
            content: `${seller} — Demande d'achat (MP fermés)`,
            embeds: [requestEmbed],
            components: [requestRow],
          });
        });
    }

    await interaction.reply({
      content:
        "⏳ Demande envoyée au vendeur.\n" +
        "S'il **accepte**, un ticket middleman sera ouvert automatiquement.",
      ephemeral: true,
    });
    return true;
  }

  // --- Vendeur accepte / refuse ---
  if (interaction.isButton() && interaction.customId.startsWith(ACCEPT_PREFIX)) {
    const requestId = interaction.customId.slice(ACCEPT_PREFIX.length);
    const state = loadState();
    const pending = state.pending[requestId];

    if (!pending) {
      await interaction.reply({
        content: "❌ Cette demande n'est plus valide.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.user.id !== pending.sellerId) {
      await interaction.reply({
        content: "❌ Seul le vendeur peut accepter cette demande.",
        ephemeral: true,
      });
      return true;
    }

    const guild = await client.guilds.fetch(pending.guildId).catch(() => null);
    if (!guild) {
      await interaction.reply({ content: "❌ Serveur introuvable.", ephemeral: true });
      return true;
    }

    const item = getItem(state, pending.itemId);
    const itemData = item || pending.itemSnapshot;

    const tradeId = `trade_${Date.now()}`;
    const trade = {
      item: {
        name: itemData.name,
        price: itemData.price,
        description: itemData.description,
      },
      itemId: pending.itemId,
      buyerId: pending.buyerId,
      sellerId: pending.sellerId,
      buyerConfirmed: false,
      sellerConfirmed: false,
      channelId: null,
      status: "pending",
      createdAt: Date.now(),
    };

    try {
      const ticketChannel = await createTradeTicket(guild, client, trade, tradeId);

      state.trades[tradeId] = trade;
      if (item) {
        state.items = state.items.filter((i) => i.id !== pending.itemId);
      }
      delete state.pending[requestId];
      saveState(state);
      await updateShopPanel(client);

      await interaction.update({
        content: `✅ Vente acceptée — ticket ouvert : ${ticketChannel}`,
        embeds: [],
        components: [],
      });

      const buyer = await guild.members.fetch(pending.buyerId).catch(() => null);
      if (buyer) {
        await buyer
          .send(
            `✅ Le vendeur a accepté ! Ticket middleman : ${ticketChannel}\n` +
              `**${itemData.name}** — ${itemData.price} €`
          )
          .catch(() => null);
      }
    } catch (err) {
      console.error("Erreur ticket boutique:", err.message);
      const payload = {
        content: "❌ Impossible de créer le ticket. Contactez un admin.",
        embeds: [],
        components: [],
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => null);
      } else if (interaction.message) {
        await interaction.update(payload).catch(() => interaction.reply(payload));
      } else {
        await interaction.reply(payload);
      }
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(REFUSE_PREFIX)) {
    const requestId = interaction.customId.slice(REFUSE_PREFIX.length);
    const state = loadState();
    const pending = state.pending[requestId];

    if (!pending) {
      await interaction.reply({
        content: "❌ Cette demande n'est plus valide.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.user.id !== pending.sellerId) {
      await interaction.reply({
        content: "❌ Seul le vendeur peut refuser.",
        ephemeral: true,
      });
      return true;
    }

    delete state.pending[requestId];
    saveState(state);

    const guild = await client.guilds.fetch(pending.guildId).catch(() => null);
    if (guild) {
      const buyer = await guild.members.fetch(pending.buyerId).catch(() => null);
      if (buyer) {
        await buyer
          .send(
            `❌ Le vendeur a refusé votre demande d'achat pour **${pending.itemSnapshot?.name || "l'article"}**.`
          )
          .catch(() => null);
      }
    }

    await interaction.update({
      content: "❌ Vente refusée.",
      embeds: [],
      components: [],
    });
    return true;
  }

  // --- Confirmations dans le ticket ---
  if (interaction.isButton() && interaction.customId.startsWith(TRADE_BUYER_PREFIX)) {
    const tradeId = interaction.customId.slice(TRADE_BUYER_PREFIX.length);
    const state = loadState();
    const trade = state.trades[tradeId];

    if (!trade || trade.status === "closed") {
      await interaction.reply({ content: "❌ Transaction terminée ou invalide.", ephemeral: true });
      return true;
    }

    if (interaction.user.id !== trade.buyerId) {
      await interaction.reply({
        content: "❌ Seul l'acheteur peut confirmer le paiement.",
        ephemeral: true,
      });
      return true;
    }

    trade.buyerConfirmed = true;
    saveState(state);
    await updateTradeMessage(interaction.guild, tradeId, state);

    await interaction.reply({
      content: "✅ Vous avez confirmé avoir **donné l'argent** au middleman.",
      ephemeral: true,
    });

    if (trade.buyerConfirmed && trade.sellerConfirmed) {
      await closeTrade(interaction.guild, client, tradeId, loadState());
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith(TRADE_SELLER_PREFIX)) {
    const tradeId = interaction.customId.slice(TRADE_SELLER_PREFIX.length);
    const state = loadState();
    const trade = state.trades[tradeId];

    if (!trade || trade.status === "closed") {
      await interaction.reply({ content: "❌ Transaction terminée ou invalide.", ephemeral: true });
      return true;
    }

    if (interaction.user.id !== trade.sellerId) {
      await interaction.reply({
        content: "❌ Seul le vendeur peut confirmer la livraison.",
        ephemeral: true,
      });
      return true;
    }

    trade.sellerConfirmed = true;
    saveState(state);
    await updateTradeMessage(interaction.guild, tradeId, state);

    await interaction.reply({
      content: "✅ Vous avez confirmé avoir **donné l'article** au middleman.",
      ephemeral: true,
    });

    if (trade.buyerConfirmed && trade.sellerConfirmed) {
      await closeTrade(interaction.guild, client, tradeId, loadState());
    }
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT.ITEM) {
    const state = loadState();
    const item = getItem(state, interaction.values[0]);
    if (!item) {
      await interaction.reply({ content: "❌ Article introuvable.", ephemeral: true });
      return true;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUY_PREFIX}${item.id}`)
        .setLabel("Acheter / Contacter")
        .setEmoji("🦋")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({
      embeds: [buildItemDetailEmbed(item, interaction.guild)],
      components: [row],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT.REMOVE) {
    if (!isSeller(interaction.member)) {
      await denySeller(interaction);
      return true;
    }

    const itemId = interaction.values[0];
    const state = loadState();
    const idx = state.items.findIndex(
      (i) => i.id === itemId && i.sellerId === interaction.user.id
    );

    if (idx === -1) {
      await interaction.update({ content: "❌ Article introuvable.", components: [] });
      return true;
    }

    const removed = state.items.splice(idx, 1)[0];
    saveState(state);
    await updateShopPanel(client);

    await interaction.update({
      content: `✅ **${removed.name}** retiré de la boutique.`,
      components: [],
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === MODAL.SELL) {
    if (!isSeller(interaction.member)) {
      await interaction.reply({ content: "❌ Permission refusée.", ephemeral: true });
      return true;
    }

    const name = interaction.fields.getTextInputValue("nom").trim();
    const price = interaction.fields.getTextInputValue("prix").trim();
    const description = interaction.fields.getTextInputValue("description").trim();

    if (!name || !price || !description) {
      await interaction.reply({ content: "❌ Tous les champs sont requis.", ephemeral: true });
      return true;
    }

    const state = loadState();
    state.items.push({
      id: `item_${Date.now()}`,
      sellerId: interaction.user.id,
      name,
      price,
      description,
      createdAt: Date.now(),
    });
    saveState(state);
    await updateShopPanel(client);

    await interaction.reply({
      content: `✅ **${name}** mis en vente pour **${price} €** !`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  setupShopPanel,
  handleShopInteraction,
  SHOP_CHANNEL_ID,
  SELLER_ROLE_ID,
};
