const crypto = require('crypto');
const { findFingerprintMatches, upsertUserFingerprint } = require('../../db');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const CLIENT_IP_HEADERS = [
  'cf-connecting-ip',
  'x-real-ip',
  'x-client-ip',
  'true-client-ip',
  'fastly-client-ip',
  'x-forwarded-for'
];

function normalizeIp(raw) {
  if (!raw) return '';
  let ip = String(raw).trim();

  if (!ip || ip === 'unknown' || ip === '-') return '';

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  }

  const ipv4PortMatch = ip.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/);
  if (ipv4PortMatch) {
    ip = ipv4PortMatch[1];
  }

  return ip;
}

function extractForwardedFor(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(extractForwardedFor);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractForwardedHeader(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(extractForwardedHeader);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const match = part.match(/for=([^;]+)/i);
      if (!match) return '';
      return match[1].replace(/^"|"$/g, '');
    })
    .filter(Boolean);
}

function pickClientIp(candidates) {
  const normalized = candidates
    .map(normalizeIp)
    .filter(Boolean);

  if (!normalized.length) return '0.0.0.0';
  const publicIp = normalized.find((ip) => !isPrivateIp(ip));
  return publicIp || normalized[0];
}

function getClientIp(req) {
  const candidates = [];

  for (const header of CLIENT_IP_HEADERS) {
    candidates.push(...extractForwardedFor(req.headers[header]));
  }

  candidates.push(...extractForwardedHeader(req.headers.forwarded));

  if (Array.isArray(req.ips) && req.ips.length) {
    candidates.push(...req.ips);
  }

  if (req.ip) {
    candidates.push(req.ip);
  }

  if (req.socket?.remoteAddress) {
    candidates.push(req.socket.remoteAddress);
  }

  return pickClientIp(candidates);
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::' || ip === '::1' || ip === '127.0.0.1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (!rawIp || isPrivateIp(rawIp)) {
    return null;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(rawIp)}`, {
      headers: {
        'User-Agent': 'discord-verify-bot/1.0',
        Accept: 'application/json'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.success === false) return null;
    return {
      country: data.country || 'Unknown',
      countryCode: data.country_code || 'XX',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      latitude: toNumber(data.latitude),
      longitude: toNumber(data.longitude),
      isp: data.connection?.isp || 'Unknown',
      org: data.connection?.org || 'Unknown',
      asn: data.connection?.asn || 'Unknown',
      timezone: data.timezone?.id || 'Unknown'
    };
  } catch (_error) {
  }

  try {
    const fallback = await fetch(`https://ipapi.co/${encodeURIComponent(rawIp)}/json/`, {
      headers: {
        'User-Agent': 'discord-verify-bot/1.0',
        Accept: 'application/json'
      }
    });
    if (!fallback.ok) return null;
    const data = await fallback.json();
    if (data?.error) return null;
    return {
      country: data.country_name || 'Unknown',
      countryCode: data.country_code || 'XX',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      latitude: toNumber(data.latitude),
      longitude: toNumber(data.longitude),
      isp: data.org || 'Unknown',
      org: data.org || 'Unknown',
      asn: data.asn || 'Unknown',
      timezone: data.timezone || 'Unknown'
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
