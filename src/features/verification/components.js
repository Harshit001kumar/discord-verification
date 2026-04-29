const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const IDs = {
  START_VERIFY: 'verify:start',
  ACCEPT_RULES: 'verify:rules:accept',
  CHALLENGE_MODAL: 'verify:challenge:modal',
  CHALLENGE_ANSWER: 'verify:challenge:answer'
};

function buildStartVerificationRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDs.START_VERIFY)
      .setLabel('Begin Verification')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Success)
  );
}

function buildWebsiteVerifyRow(url) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open Verification Portal')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

function buildRulesRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDs.ACCEPT_RULES)
      .setLabel('Accept Rules and Continue')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildChallengeModal(question) {
  const input = new TextInputBuilder()
    .setCustomId(IDs.CHALLENGE_ANSWER)
    .setLabel(`Answer: ${question}`)
    .setPlaceholder('Enter the result')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(8);

  return new ModalBuilder()
    .setCustomId(IDs.CHALLENGE_MODAL)
    .setTitle('Security Check')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = {
  IDs,
  buildStartVerificationRow,
  buildWebsiteVerifyRow,
  buildRulesRow,
  buildChallengeModal
};
