const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

const config = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: requireEnv('GUILD_ID'),
  ownerId: process.env.BOT_OWNER_ID ? process.env.BOT_OWNER_ID.trim() : null,
  dbPath: path.resolve(process.cwd(), 'data', 'verification.db'),
  publicBaseUrl: requireEnv('PUBLIC_BASE_URL').replace(/\/$/, ''),
  clientSecret: requireEnv('DISCORD_CLIENT_SECRET'),
  redirectPath: (process.env.REDIRECT_PATH || '/auth/discord/callback').trim(),
  sessionSecret: requireEnv('SESSION_SECRET'),
  port: Number(process.env.PORT || 3000)
};

config.redirectUri = `${config.publicBaseUrl}${config.redirectPath.startsWith('/') ? config.redirectPath : `/${config.redirectPath}`}`;

module.exports = config;
