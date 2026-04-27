const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const commandDefs = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure verification settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('verification_channel')
        .setDescription('Channel to post verification panel')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption((opt) =>
      opt
        .setName('log_channel')
        .setDescription('Channel to receive verification logs')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addRoleOption((opt) => opt.setName('verified_role').setDescription('Role granted on success').setRequired(true))
    .addRoleOption((opt) => opt.setName('unverified_role').setDescription('Role removed on success').setRequired(false)),

  new SlashCommandBuilder()
    .setName('verify-config')
    .setDescription('Show verification config')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('verify-toggle')
    .setDescription('Enable or disable verification system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable or disable').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify-security')
    .setDescription('Configure anti-alt security controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
      opt
        .setName('min_account_age_days')
        .setDescription('Minimum account age in days')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(365)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('auto_kick_on_fail')
        .setDescription('Kick user after repeated failures')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('require_rules_ack')
        .setDescription('Require rules acceptance before challenge')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('require_challenge')
        .setDescription('Require challenge before website verification')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('verify-reset-user')
    .setDescription('Reset verification status for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) => opt.setName('user').setDescription('User to reset').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify-whitelist')
    .setDescription('Manage verification whitelist')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add user to whitelist')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove user from whitelist')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List whitelist entries')),

  new SlashCommandBuilder()
    .setName('verify-blacklist')
    .setDescription('Manage verification blacklist')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add user to blacklist')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove user from blacklist')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List blacklist entries')),

  new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull previously authorized users into this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('How many users to attempt in this run (max 100)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
].map((c) => c.toJSON());

module.exports = {
  commandDefs
};
