const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../db');

async function logEvent(guild, title, fields = [], color = 0x2b2d31) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.log_channel_id) return;

  const channel = guild.channels.cache.get(cfg.log_channel_id);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  logEvent
};
