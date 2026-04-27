const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');
const config = require('./config');
const {
  getGuildConfig,
  updateGuildConfig,
  resetVerificationState,
  addWhitelist,
  removeWhitelist,
  getWhitelist,
  addBlacklist,
  removeBlacklist,
  getBlacklist,
  isBlacklisted
} = require('./db');
const { registerCommands } = require('./register');
const { isGuildAdmin } = require('./utils/permissions');
const {
  IDs,
  buildStartVerificationRow
} = require('./features/verification/components');
const {
  beginVerification,
  handleRulesAccepted,
  handleChallengeSubmit
} = require('./features/verification/flow');
const { startWebServer } = require('./web/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let webStarted = false;

function bool(v) {
  return v ? 'Enabled' : 'Disabled';
}

async function handleSetup(interaction) {
  const verificationChannel = interaction.options.getChannel('verification_channel', true);
  const logChannel = interaction.options.getChannel('log_channel', true);
  const verifiedRole = interaction.options.getRole('verified_role', true);
  const unverifiedRole = interaction.options.getRole('unverified_role', false);

  updateGuildConfig(interaction.guild.id, {
    verification_channel_id: verificationChannel.id,
    log_channel_id: logChannel.id,
    verified_role_id: verifiedRole.id,
    unverified_role_id: unverifiedRole ? unverifiedRole.id : null,
    enabled: 1
  });

  const panel = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Server Verification')
    .setDescription('Click the button below to start verification. You will complete the final step on the secure website.')
    .setFooter({ text: 'Premium verification flow' });

  await verificationChannel.send({ embeds: [panel], components: [buildStartVerificationRow()] });
  await interaction.reply({ content: 'Verification configured and panel posted.', ephemeral: true });
}

async function handleVerifyConfig(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Verification Configuration')
    .addFields(
      { name: 'System', value: bool(!!cfg.enabled), inline: true },
      { name: 'Rules Ack', value: bool(!!cfg.require_rules_ack), inline: true },
      { name: 'Challenge', value: bool(!!cfg.require_challenge), inline: true },
      { name: 'Min Account Age', value: `${cfg.min_account_age_days} day(s)`, inline: true },
      { name: 'Auto Kick on Fail', value: bool(!!cfg.auto_kick_on_fail), inline: true },
      { name: 'Verified Role', value: cfg.verified_role_id ? `<@&${cfg.verified_role_id}>` : 'Not set', inline: true },
      { name: 'Unverified Role', value: cfg.unverified_role_id ? `<@&${cfg.unverified_role_id}>` : 'Not set', inline: true },
      { name: 'Verification Channel', value: cfg.verification_channel_id ? `<#${cfg.verification_channel_id}>` : 'Not set', inline: true },
      { name: 'Log Channel', value: cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : 'Not set', inline: true }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleVerifySecurity(interaction) {
  const minAge = interaction.options.getInteger('min_account_age_days', false);
  const autoKick = interaction.options.getBoolean('auto_kick_on_fail', false);
  const rules = interaction.options.getBoolean('require_rules_ack', false);
  const challenge = interaction.options.getBoolean('require_challenge', false);

  const patch = {};
  if (minAge !== null) patch.min_account_age_days = minAge;
  if (autoKick !== null) patch.auto_kick_on_fail = autoKick ? 1 : 0;
  if (rules !== null) patch.require_rules_ack = rules ? 1 : 0;
  if (challenge !== null) patch.require_challenge = challenge ? 1 : 0;

  if (!Object.keys(patch).length) {
    await interaction.reply({ content: 'No values provided.', ephemeral: true });
    return;
  }

  updateGuildConfig(interaction.guild.id, patch);
  await interaction.reply({ content: 'Security settings updated.', ephemeral: true });
}

async function handleWhitelist(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') {
    const user = interaction.options.getUser('user', true);
    addWhitelist(interaction.guild.id, user.id, interaction.user.id);
    await interaction.reply({ content: `Added <@${user.id}> to whitelist.`, ephemeral: true });
    return;
  }
  if (sub === 'remove') {
    const user = interaction.options.getUser('user', true);
    removeWhitelist(interaction.guild.id, user.id);
    await interaction.reply({ content: `Removed <@${user.id}> from whitelist.`, ephemeral: true });
    return;
  }

  const entries = getWhitelist(interaction.guild.id);
  const text = entries.length
    ? entries.slice(0, 20).map((x) => `<@${x.user_id}>`).join(', ')
    : 'No entries.';
  await interaction.reply({ content: `Whitelist: ${text}`, ephemeral: true });
}

async function handleBlacklist(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', false);
    addBlacklist(interaction.guild.id, user.id, interaction.user.id, reason);
    await interaction.reply({ content: `Added <@${user.id}> to blacklist.`, ephemeral: true });
    return;
  }
  if (sub === 'remove') {
    const user = interaction.options.getUser('user', true);
    removeBlacklist(interaction.guild.id, user.id);
    await interaction.reply({ content: `Removed <@${user.id}> from blacklist.`, ephemeral: true });
    return;
  }

  const entries = getBlacklist(interaction.guild.id);
  const text = entries.length
    ? entries.slice(0, 20).map((x) => `<@${x.user_id}>`).join(', ')
    : 'No entries.';
  await interaction.reply({ content: `Blacklist: ${text}`, ephemeral: true });
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (!webStarted) {
    startWebServer(client);
    webStarted = true;
  }
});

client.on('guildMemberAdd', async (member) => {
  const cfg = getGuildConfig(member.guild.id);
  if (cfg.unverified_role_id && !member.roles.cache.has(cfg.unverified_role_id)) {
    await member.roles.add(cfg.unverified_role_id).catch(() => {});
  }
  const blacklisted = isBlacklisted(member.guild.id, member.id);
  if (blacklisted) {
    await member.kick('User is blacklisted from verification').catch(() => {});
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!isGuildAdmin(interaction)) {
        await interaction.reply({ content: 'Admin only command.', ephemeral: true });
        return;
      }

      switch (interaction.commandName) {
        case 'setup':
          await handleSetup(interaction);
          return;
        case 'verify-config':
          await handleVerifyConfig(interaction);
          return;
        case 'verify-toggle': {
          const enabled = interaction.options.getBoolean('enabled', true);
          updateGuildConfig(interaction.guild.id, { enabled: enabled ? 1 : 0 });
          await interaction.reply({ content: `Verification ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
          return;
        }
        case 'verify-security':
          await handleVerifySecurity(interaction);
          return;
        case 'verify-reset-user': {
          const user = interaction.options.getUser('user', true);
          resetVerificationState(interaction.guild.id, user.id);
          await interaction.reply({ content: `Reset verification state for <@${user.id}>.`, ephemeral: true });
          return;
        }
        case 'verify-whitelist':
          await handleWhitelist(interaction);
          return;
        case 'verify-blacklist':
          await handleBlacklist(interaction);
          return;
        default:
          return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === IDs.START_VERIFY) {
        await beginVerification(interaction);
        return;
      }
      if (interaction.customId === IDs.ACCEPT_RULES) {
        await handleRulesAccepted(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === IDs.CHALLENGE_MODAL) {
      await handleChallengeSubmit(interaction);
    }
  } catch (error) {
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: 'Something went wrong. Please retry.', ephemeral: true }).catch(() => {});
    }
  }
});

async function main() {
  if (process.argv.includes('--register')) {
    await registerCommands();
    process.exit(0);
  }
  await client.login(config.token);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
