const FONDATION_ROLE_ID = "1509974377267990659";

function isFondation(member) {
  return member?.roles.cache.has(FONDATION_ROLE_ID) ?? false;
}

async function handleChatInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "chat") {
    return false;
  }

  if (!isFondation(interaction.member)) {
    await interaction.reply({
      content: `❌ Seule la **Fondation** <@&${FONDATION_ROLE_ID}> peut utiliser \`/chat\`.`,
      ephemeral: true,
    });
    return true;
  }

  const message = interaction.options.getString("message", true).trim();
  if (!message) {
    await interaction.reply({
      content: "❌ Le message ne peut pas être vide.",
      ephemeral: true,
    });
    return true;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: "❌ Cette commande ne peut être utilisée que dans un salon textuel.",
      ephemeral: true,
    });
    return true;
  }

  await channel.send(message);
  await interaction.reply({
    content: "✅ Message envoyé par le bot.",
    ephemeral: true,
  });
  return true;
}

module.exports = { handleChatInteraction, FONDATION_ROLE_ID };
