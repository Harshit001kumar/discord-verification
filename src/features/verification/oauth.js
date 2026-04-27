const crypto = require('crypto');
const config = require('../../config');
const { createOauthSession, consumeOauthSession } = require('../../db');

function createState() {
  return crypto.randomBytes(24).toString('hex');
}

function buildAuthorizeUrl(guildId) {
  const state = createState();
  createOauthSession(state, guildId);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'identify guilds.join',
    state,
    prompt: 'consent'
  });

  return {
    state,
    url: `https://discord.com/oauth2/authorize?${params.toString()}`
  };
}

function getSessionFromState(state) {
  return consumeOauthSession(state);
}

module.exports = {
  buildAuthorizeUrl,
  getSessionFromState
};
