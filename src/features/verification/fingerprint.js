const crypto = require('crypto');
const { findFingerprintMatches, upsertUserFingerprint } = require('../../db');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

function getDeviceSignature(req) {
  const ua = req.headers['user-agent'] || 'unknown';
  const lang = req.headers['accept-language'] || 'unknown';
  const secUa = req.headers['sec-ch-ua'] || 'unknown';
  return `${ua}|${lang}|${secUa}`;
}

function evaluateFingerprint(guildId, userId, req) {
  const rawIp = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ipHash = sha256(rawIp);
  const deviceHash = sha256(getDeviceSignature(req));

  const matches = findFingerprintMatches(guildId, ipHash, deviceHash)
    .map((row) => row.user_id)
    .filter((existingUserId) => existingUserId !== userId);

  upsertUserFingerprint(guildId, userId, {
    ipHash,
    deviceHash,
    rawIp,
    userAgent
  });

  return {
    duplicateUsers: [...new Set(matches)],
    ipHash,
    deviceHash,
    rawIp,
    userAgent
  };
}

module.exports = {
  evaluateFingerprint
};
