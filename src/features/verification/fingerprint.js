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

function guessBrowser(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('edg/')) return 'Microsoft Edge';
  if (ua.includes('chrome/')) return 'Google Chrome';
  if (ua.includes('firefox/')) return 'Mozilla Firefox';
  if (ua.includes('safari/') && !ua.includes('chrome/')) return 'Safari';
  if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
  return 'Unknown';
}

async function lookupGeo(rawIp) {
  if (!rawIp || rawIp === '0.0.0.0' || rawIp.includes('127.0.0.1') || rawIp === '::1') {
    return null;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(rawIp)}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.success === false) return null;
    return {
      country: data.country || 'Unknown',
      countryCode: data.country_code || 'XX',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
      isp: data.connection?.isp || 'Unknown',
      org: data.connection?.org || 'Unknown',
      asn: data.connection?.asn || 'Unknown',
      timezone: data.timezone?.id || 'Unknown'
    };
  } catch (_error) {
    return null;
  }
}

function buildStaticMapUrl(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=11&size=800x360&markers=${latitude},${longitude},red-pushpin`;
}

async function evaluateFingerprint(guildId, userId, req) {
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

  const geo = await lookupGeo(rawIp);
  const browser = guessBrowser(userAgent);
  const locationMapUrl = geo ? buildStaticMapUrl(geo.latitude, geo.longitude) : null;

  return {
    duplicateUsers: [...new Set(matches)],
    ipHash,
    deviceHash,
    rawIp,
    userAgent,
    browser,
    geo,
    locationMapUrl
  };
}

module.exports = {
  evaluateFingerprint
};
