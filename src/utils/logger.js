const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../db');

async function logEvent(guild, title, fields = [], color = 0x2b2d31, options = {}) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.log_channel_id) return;

  let channel = guild.channels.cache.get(cfg.log_channel_id);
  if (!channel) {
    channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
  }
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp();

  if (fields.length) {
    embed.addFields(fields);
  }
  if (options.description) {
    embed.setDescription(options.description);
  }
  if (options.imageUrl) {
    embed.setImage(options.imageUrl);
  }
  if (options.footer) {
    embed.setFooter({ text: options.footer });
  }

  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error(`Failed to send log event (${title}):`, error.message);
  });
}

module.exports = {
  logEvent
};
