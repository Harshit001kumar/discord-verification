const { EmbedBuilder } = require('discord.js');
const {
  getGuildConfig,
  upsertVerificationState,
  getVerificationState,
  isWhitelisted,
  isBlacklisted
} = require('../../db');
const { logEvent } = require('../../utils/logger');
const { buildRulesRow, buildChallengeModal, buildWebsiteVerifyRow } = require('./components');
const { createChallenge } = require('./challenge');
const { calculateRisk } = require('./risk');
const { buildAuthorizeUrl } = require('./oauth');

const pendingChallengeAnswers = new Map();

function challengeKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function assignVerified(member, cfg) {
  if (cfg.unverified_role_id && member.roles.cache.has(cfg.unverified_role_id)) {
    await member.roles.remove(cfg.unverified_role_id).catch(() => {});
  }
  if (cfg.verified_role_id && !member.roles.cache.has(cfg.verified_role_id)) {
    await member.roles.add(cfg.verified_role_id).catch(() => {});
  }
}

async function beginVerification(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const cfg = getGuildConfig(guild.id);

  if (!cfg.enabled) {
    await interaction.reply({
      content: 'Verification is currently disabled on this server.',
      ephemeral: true
    });
    return;
  }

  const blacklisted = isBlacklisted(guild.id, member.id);
  if (blacklisted) {
    upsertVerificationState(guild.id, member.id, {
      status: 'blocked',
      last_reason: blacklisted.reason || 'blacklisted'
    });
    await interaction.reply({
      content: 'You are blocked from verification. Contact staff if this is a mistake.',
      ephemeral: true
    });
    await logEvent(guild, 'Verification Blocked', [
      { name: 'User', value: `<@${member.id}>`, inline: true },
      { name: 'Reason', value: blacklisted.reason || 'Blacklisted', inline: true }
    ], 0xed4245);
    return;
  }

  if (isWhitelisted(guild.id, member.id)) {
    await assignVerified(member, cfg);
    upsertVerificationState(guild.id, member.id, {
      status: 'verified',
      risk_score: 0,
      last_reason: 'whitelisted'
    });
    await interaction.reply({ content: 'You were instantly verified (whitelisted).', ephemeral: true });
    await logEvent(guild, 'User Verified (Whitelist)', [
      { name: 'User', value: `<@${member.id}>`, inline: true }
    ], 0x57f287);
    return;
  }

  const state = getVerificationState(guild.id, member.id);
  const risk = calculateRisk({
    user: member.user,
    minAccountAgeDays: cfg.min_account_age_days,
    failedAttempts: state?.attempts || 0
  });

  upsertVerificationState(guild.id, member.id, {
    status: 'in_progress',
    risk_score: risk.score,
    last_reason: risk.reasons.join('; ') || null
  });

  if (risk.level === 'high') {
    await interaction.reply({
      content: 'Your account requires manual review by staff. A ticket has been suggested in logs.',
      ephemeral: true
    });
    await logEvent(guild, 'Manual Review Required', [
      { name: 'User', value: `<@${member.id}>`, inline: true },
      { name: 'Risk Score', value: String(risk.score), inline: true },
      { name: 'Reasons', value: risk.reasons.join('\n') || 'None' }
    ], 0xfee75c);
    return;
  }

  if (cfg.require_rules_ack) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Rules Confirmation')
      .setDescription('Please confirm you have read and will follow the server rules to continue.')
      .setFooter({ text: 'Step 1/2' });

    await interaction.reply({ embeds: [embed], components: [buildRulesRow()], ephemeral: true });
    return;
  }

  await showChallenge(interaction, cfg);
}

async function handleRulesAccepted(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  await showChallenge(interaction, cfg, true);
}

async function showChallenge(interaction, cfg, updateMessage = false) {
  if (!cfg.require_challenge) {
    await sendWebsiteStep(interaction, 'Challenge skipped by configuration. Continue on website.');
    return;
  }

  const challenge = createChallenge();
  pendingChallengeAnswers.set(challengeKey(interaction.guild.id, interaction.user.id), challenge.answer);
  const modal = buildChallengeModal(challenge.question);

  if (updateMessage && interaction.isButton()) {
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isButton()) {
    await interaction.showModal(modal);
    return;
  }
}

async function handleChallengeSubmit(interaction) {
  const key = challengeKey(interaction.guild.id, interaction.user.id);
  const expected = pendingChallengeAnswers.get(key);
  const answer = interaction.fields.getTextInputValue('verify:challenge:answer').trim();
  pendingChallengeAnswers.delete(key);

  const cfg = getGuildConfig(interaction.guild.id);
  const state = getVerificationState(interaction.guild.id, interaction.user.id);

  if (!expected) {
    await interaction.reply({ content: 'Challenge expired. Please start again.', ephemeral: true });
    return;
  }

  if (answer !== expected) {
    const attempts = (state?.attempts || 0) + 1;
    upsertVerificationState(interaction.guild.id, interaction.user.id, {
      status: 'failed',
      attempts,
      last_reason: 'challenge_failed'
    });

    await interaction.reply({ content: 'Incorrect challenge answer. Please retry verification.', ephemeral: true });
    await logEvent(interaction.guild, 'Challenge Failed', [
      { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Attempts', value: String(attempts), inline: true }
    ], 0xed4245);

    if (cfg.auto_kick_on_fail && attempts >= 3) {
      const member = interaction.member;
      await member.kick('Verification failed 3 times').catch(() => {});
      await logEvent(interaction.guild, 'User Kicked After Verification Failures', [
        { name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }
      ], 0xed4245);
    }

    return;
  }

  await sendWebsiteStep(interaction, 'Challenge passed. Continue on website to finish verification.');
}

async function sendWebsiteStep(interaction, message) {
  const { url } = buildAuthorizeUrl(interaction.guild.id);
  const payload = {
    content: message,
    components: [buildWebsiteVerifyRow(url)],
    ephemeral: true
  };

  if (interaction.isModalSubmit()) {
    await interaction.reply(payload);
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function finishSuccess(guild, member, cfg, interaction, reason) {
  await assignVerified(member, cfg);
  upsertVerificationState(guild.id, member.id, {
    status: 'verified',
    attempts: 0,
    last_reason: reason
  });

  if (interaction.isModalSubmit()) {
    await interaction.reply({ content: 'Verification complete. Welcome!', ephemeral: true });
  } else {
    await interaction.followUp({ content: 'Verification complete. Welcome!', ephemeral: true });
  }

  await logEvent(guild, 'User Verified', [
    { name: 'User', value: `<@${member.id}>`, inline: true },
    { name: 'Reason', value: reason, inline: true }
  ], 0x57f287);
}

async function finalizeMemberVerification(guild, member, reason = 'Website OAuth verification') {
  const cfg = getGuildConfig(guild.id);
  await assignVerified(member, cfg);
  upsertVerificationState(guild.id, member.id, {
    status: 'verified',
    attempts: 0,
    last_reason: reason
  });
  await logEvent(guild, 'User Verified', [
    { name: 'User', value: `<@${member.id}>`, inline: true },
    { name: 'Reason', value: reason, inline: true }
  ], 0x57f287);
}

module.exports = {
  beginVerification,
  handleRulesAccepted,
  handleChallengeSubmit,
  finalizeMemberVerification
};
