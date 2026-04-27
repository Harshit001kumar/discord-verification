# Discord Verification Bot (Premium-Style)

This project is a production-ready foundation for a premium-style Discord verification bot inspired by high-end verification bots.

## Features

- `/setup` wizard for initial server setup (admin only)
- Join gate with verification button
- Rules acknowledgement flow
- Captcha-like challenge flow
- Website OAuth verification (Discord redirect URL compatible)
- Requires `identify` + `guilds.join` OAuth scopes
- IP + device fingerprint matching to flag alt accounts
- Automatic role assignment only when security checks pass
- Account age check with configurable threshold
- Anti-alt basic risk scoring
- Ticket escalation for failed/flagged verifications
- Logging to a dedicated channel
- Role assignment on success
- Admin panel commands:
  - `/verify-config`
  - `/verify-toggle`
  - `/verify-reset-user`
  - `/verify-whitelist`
  - `/verify-blacklist`
- Persistent storage via SQLite
- Clean modular code structure for custom premium extensions

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill values.

3. Start bot:

   ```bash
   npm run start
   ```

4. Register slash commands:

   ```bash
   npm run register
   ```

## Environment Variables

- `DISCORD_TOKEN` – bot token
- `CLIENT_ID` – application client ID
- `GUILD_ID` – target guild for command registration
- `BOT_OWNER_ID` – optional owner user ID for hard-admin commands
- `PUBLIC_BASE_URL` – Render app URL (example: `https://my-bot.onrender.com`)
- `DISCORD_CLIENT_SECRET` – OAuth2 client secret
- `REDIRECT_PATH` – callback path (default `/auth/discord/callback`)
- `SESSION_SECRET` – reserved secret for future encrypted sessions
- `PORT` – web server port (Render provides this automatically)
- `AUTO_REGISTER_COMMANDS` – set `true` to register slash commands on startup (useful for Render free tier)

## Render Setup

1. Deploy as a Web Service.
2. Start command: `npm run start`.
3. Add all env vars from `.env.example`.
4. In Discord Developer Portal > OAuth2, set redirect URL to:

   `PUBLIC_BASE_URL + REDIRECT_PATH`

   Example: `https://my-bot.onrender.com/auth/discord/callback`

5. Ensure bot invite includes permissions for role management and required scopes.

## Health Endpoint

- `GET /health` returns JSON health status of:
  - Discord gateway readiness
  - SQLite database availability
  - OAuth config presence
  - Web service process
- Returns HTTP `200` when all checks are healthy, otherwise `503`.

## Security Flow

1. User clicks verify in Discord.
2. User passes server-side rules/challenge checks.
3. User is redirected to website OAuth callback.
4. Bot stores hashed IP/device fingerprint and compares with prior verified users.
5. If duplicate fingerprint is detected, user is flagged for manual review.
6. If clean, verified role is granted automatically.

## Notes

- This is a full starter with premium-style architecture, not a copy of any proprietary bot.
- Extend modules under `src/features` to add paid-tier capabilities like web dashboard, OAuth link, AI risk scoring, etc.
