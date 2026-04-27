const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { getSessionFromState } = require('../features/verification/oauth');
const { evaluateFingerprint } = require('../features/verification/fingerprint');
const { finalizeMemberVerification } = require('../features/verification/flow');
const { db, upsertVerificationState } = require('../db');
const { logEvent } = require('../utils/logger');

function makeCookie(name, value, maxAgeSeconds) {
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${name}:${value}`)
    .digest('hex')
    .slice(0, 16);
  return `${name}=${value}.${sig}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri
  });

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Discord token exchange failed (${response.status})`);
  }

  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord user fetch failed (${response.status})`);
  }

  return response.json();
}

function startWebServer(client) {
  const app = express();
  app.set('trust proxy', true);

  app.get('/health', async (_req, res) => {
    const checks = {
      discord: { ok: false, detail: null },
      database: { ok: false, detail: null },
      oauth: { ok: false, detail: null },
      web: { ok: true, detail: 'express_up' }
    };

    try {
      checks.discord.ok = !!client.isReady();
      checks.discord.detail = checks.discord.ok ? `bot:${client.user?.tag || 'ready'}` : 'bot_not_ready';
    } catch (error) {
      checks.discord.detail = error.message;
    }

    try {
      db.prepare('SELECT 1 AS ok').get();
      checks.database.ok = true;
      checks.database.detail = 'sqlite_ok';
    } catch (error) {
      checks.database.detail = error.message;
    }

    checks.oauth.ok = Boolean(config.clientId && config.clientSecret && config.redirectUri);
    checks.oauth.detail = checks.oauth.ok ? config.redirectUri : 'oauth_env_missing';

    const allHealthy = Object.values(checks).every((item) => item.ok);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks
    });
  });

  app.get(config.redirectPath, async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
      res.status(400).send('Invalid callback.');
      return;
    }

    const session = getSessionFromState(String(state));
    if (!session) {
      res.status(400).send('Session expired or invalid state.');
      return;
    }

    try {
      const tokenData = await exchangeCode(String(code));
      const discordUser = await fetchDiscordUser(tokenData.access_token);
      const guild = await client.guilds.fetch(session.guild_id);
      let member = await guild.members.fetch(discordUser.id).catch(() => null);

      if (!member) {
        await guild.members.add(discordUser.id, { accessToken: tokenData.access_token }).catch(() => null);
        member = await guild.members.fetch(discordUser.id).catch(() => null);
      }

      if (!member) {
        res.status(403).send('Could not add you to the server. Please join manually and retry.');
        return;
      }

      const fp = evaluateFingerprint(guild.id, member.id, req);
      if (fp.duplicateUsers.length > 0) {
        upsertVerificationState(guild.id, member.id, {
          status: 'manual_review',
          last_reason: `duplicate_fingerprint:${fp.duplicateUsers.join(',')}`
        });

        await logEvent(guild, 'Manual Review: Alt Risk', [
          { name: 'User', value: `<@${member.id}>`, inline: true },
          { name: 'Matched Users', value: fp.duplicateUsers.map((id) => `<@${id}>`).join(', ') || 'None' },
          { name: 'IP', value: fp.rawIp, inline: true }
        ], 0xfee75c);

        res.status(200).send('Verification submitted. Staff review required before role is granted.');
        return;
      }

      await finalizeMemberVerification(guild, member, 'Website OAuth + fingerprint checks passed');
      res.setHeader('Set-Cookie', makeCookie('verified', '1', 3600));
      res.status(200).send('Verification complete. You can return to Discord.');
    } catch (error) {
      res.status(500).send('Verification failed. Please retry in a moment.');
    }
  });

  app.listen(config.port, () => {
    console.log(`Web verification server running on :${config.port}`);
  });
}

module.exports = {
  startWebServer
};
