const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  verification_channel_id TEXT,
  log_channel_id TEXT,
  verified_role_id TEXT,
  unverified_role_id TEXT,
  min_account_age_days INTEGER NOT NULL DEFAULT 7,
  require_rules_ack INTEGER NOT NULL DEFAULT 1,
  require_challenge INTEGER NOT NULL DEFAULT 1,
  auto_kick_on_fail INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_state (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL DEFAULT 0,
  last_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS whitelist (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS blacklist (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  state TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_fingerprints (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  raw_ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS fingerprint_index (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fingerprint_ip ON fingerprint_index (guild_id, ip_hash);
CREATE INDEX IF NOT EXISTS idx_fingerprint_device ON fingerprint_index (guild_id, device_hash);
`);

function nowIso() {
  return new Date().toISOString();
}

function ensureGuildConfig(guildId) {
  const existing = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  if (existing) return existing;

  const now = nowIso();
  db.prepare(`
    INSERT INTO guild_config (
      guild_id, created_at, updated_at
    ) VALUES (?, ?, ?)
  `).run(guildId, now, now);

  return db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
}

function getGuildConfig(guildId) {
  return ensureGuildConfig(guildId);
}

function updateGuildConfig(guildId, partial) {
  ensureGuildConfig(guildId);
  const keys = Object.keys(partial);
  if (!keys.length) return getGuildConfig(guildId);

  const setClause = keys.map((key) => `${key} = @${key}`).join(', ');
  const stmt = db.prepare(`
    UPDATE guild_config
    SET ${setClause}, updated_at = @updated_at
    WHERE guild_id = @guild_id
  `);

  stmt.run({
    guild_id: guildId,
    updated_at: nowIso(),
    ...partial
  });

  return getGuildConfig(guildId);
}

function getVerificationState(guildId, userId) {
  return db.prepare('SELECT * FROM verification_state WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function upsertVerificationState(guildId, userId, partial) {
  const existing = getVerificationState(guildId, userId);
  const next = {
    status: 'pending',
    attempts: 0,
    risk_score: 0,
    last_reason: null,
    ...(existing || {}),
    ...partial,
    updated_at: nowIso()
  };

  db.prepare(`
    INSERT INTO verification_state (
      guild_id, user_id, status, attempts, risk_score, last_reason, updated_at
    ) VALUES (
      @guild_id, @user_id, @status, @attempts, @risk_score, @last_reason, @updated_at
    )
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET
      status = excluded.status,
      attempts = excluded.attempts,
      risk_score = excluded.risk_score,
      last_reason = excluded.last_reason,
      updated_at = excluded.updated_at
  `).run({
    guild_id: guildId,
    user_id: userId,
    ...next
  });

  return getVerificationState(guildId, userId);
}

function resetVerificationState(guildId, userId) {
  db.prepare('DELETE FROM verification_state WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function isWhitelisted(guildId, userId) {
  return !!db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function addWhitelist(guildId, userId, addedBy) {
  db.prepare(`
    INSERT INTO whitelist (guild_id, user_id, added_by, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET added_by = excluded.added_by, created_at = excluded.created_at
  `).run(guildId, userId, addedBy, nowIso());
}

function removeWhitelist(guildId, userId) {
  db.prepare('DELETE FROM whitelist WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function getWhitelist(guildId) {
  return db.prepare('SELECT * FROM whitelist WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
}

function isBlacklisted(guildId, userId) {
  return db.prepare('SELECT * FROM blacklist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function addBlacklist(guildId, userId, addedBy, reason) {
  db.prepare(`
    INSERT INTO blacklist (guild_id, user_id, added_by, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET added_by = excluded.added_by, reason = excluded.reason, created_at = excluded.created_at
  `).run(guildId, userId, addedBy, reason || null, nowIso());
}

function removeBlacklist(guildId, userId) {
  db.prepare('DELETE FROM blacklist WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function getBlacklist(guildId) {
  return db.prepare('SELECT * FROM blacklist WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
}

function createOauthSession(state, guildId) {
  db.prepare('INSERT INTO oauth_sessions (state, guild_id, created_at) VALUES (?, ?, ?)').run(state, guildId, nowIso());
}

function consumeOauthSession(state) {
  const row = db.prepare('SELECT * FROM oauth_sessions WHERE state = ?').get(state);
  if (!row) return null;
  db.prepare('DELETE FROM oauth_sessions WHERE state = ?').run(state);
  return row;
}

function findFingerprintMatches(guildId, ipHash, deviceHash) {
  return db.prepare(`
    SELECT DISTINCT user_id
    FROM fingerprint_index
    WHERE guild_id = ?
      AND (ip_hash = ? OR device_hash = ?)
  `).all(guildId, ipHash, deviceHash);
}

function upsertUserFingerprint(guildId, userId, data) {
  db.prepare(`
    INSERT INTO user_fingerprints (
      guild_id, user_id, ip_hash, device_hash, raw_ip, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id)
    DO UPDATE SET
      ip_hash = excluded.ip_hash,
      device_hash = excluded.device_hash,
      raw_ip = excluded.raw_ip,
      user_agent = excluded.user_agent,
      created_at = excluded.created_at
  `).run(
    guildId,
    userId,
    data.ipHash,
    data.deviceHash,
    data.rawIp,
    data.userAgent,
    nowIso()
  );

  db.prepare(`
    INSERT INTO fingerprint_index (guild_id, user_id, ip_hash, device_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, userId, data.ipHash, data.deviceHash, nowIso());
}

function getUserFingerprint(guildId, userId) {
  return db.prepare('SELECT * FROM user_fingerprints WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

module.exports = {
  db,
  getGuildConfig,
  updateGuildConfig,
  getVerificationState,
  upsertVerificationState,
  resetVerificationState,
  isWhitelisted,
  addWhitelist,
  removeWhitelist,
  getWhitelist,
  isBlacklisted,
  addBlacklist,
  removeBlacklist,
  getBlacklist,
  createOauthSession,
  consumeOauthSession,
  findFingerprintMatches,
  upsertUserFingerprint,
  getUserFingerprint
};
