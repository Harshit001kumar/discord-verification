const { PermissionFlagsBits } = require('discord.js');

function isGuildAdmin(interaction) {
  if (!interaction.inGuild()) return false;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
}

module.exports = {
  isGuildAdmin
};
