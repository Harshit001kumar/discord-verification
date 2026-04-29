const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { getSessionFromState } = require('../features/verification/oauth');
const { evaluateFingerprint } = require('../features/verification/fingerprint');
const { finalizeMemberVerification } = require('../features/verification/flow');
const { db, upsertVerificationState, upsertOauthUser } = require('../db');
const { logEvent } = require('../utils/logger');

const pageStyles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap');
  :root {
    --bg: #0b1418;
    --bg-accent: #0f1c22;
    --card: rgba(12, 18, 24, 0.92);
    --text: #e6edf3;
    --muted: #9fb0bd;
    --ok: #14b8a6;
    --warn: #f59e0b;
    --err: #ef4444;
    --brand: #2dd4bf;
    --ring: rgba(45, 212, 191, 0.35);
    --accent: var(--brand);
    --font-display: "Space Grotesk", "Trebuchet MS", "Segoe UI", sans-serif;
    --font-body: "IBM Plex Sans", "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font-body);
    color: var(--text);
    background:
      radial-gradient(900px 520px at 10% -15%, rgba(45, 212, 191, 0.18) 0%, transparent 60%),
      radial-gradient(960px 520px at 110% 120%, rgba(245, 158, 11, 0.16) 0%, transparent 55%),
      linear-gradient(155deg, var(--bg), var(--bg-accent));
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 26px;
    overflow: hidden;
    position: relative;
  }
  .bg-canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    opacity: 0.35;
    mix-blend-mode: screen;
    pointer-events: none;
  }
  .orb {
    position: fixed;
    width: 360px;
    height: 360px;
    border-radius: 50%;
    filter: blur(0px);
    opacity: 0.45;
    z-index: 1;
    pointer-events: none;
    animation: drift 12s ease-in-out infinite;
  }
  .orb-a {
    top: -140px;
    left: -120px;
    background: radial-gradient(circle at 30% 30%, rgba(45, 212, 191, 0.55), transparent 70%);
  }
  .orb-b {
    bottom: -160px;
    right: -120px;
    background: radial-gradient(circle at 40% 40%, rgba(251, 191, 36, 0.55), transparent 70%);
    animation-delay: -4s;
  }
  .card {
    width: min(820px, 100%);
    background: var(--card);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 20px;
    box-shadow: 0 30px 60px rgba(2, 6, 23, 0.6);
    overflow: hidden;
    animation: cardIn 360ms ease;
    position: relative;
    z-index: 2;
    backdrop-filter: blur(14px) saturate(120%);
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(140deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }
  .card::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(560px 280px at 0% 0%, var(--accent) 0%, transparent 70%);
    opacity: 0.15;
    pointer-events: none;
  }
  @keyframes cardIn {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes drift {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(18px); }
  }
  .head {
    padding: 24px 28px 18px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    display: grid;
    gap: 10px;
    position: relative;
    z-index: 1;
  }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .brand {
    font-size: 0.72rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.45);
    border: 1px solid rgba(148, 163, 184, 0.2);
    font-size: 0.78rem;
    color: var(--text);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 0 0 6px rgba(45, 212, 191, 0.2);
  }
  .title {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.3px;
    font-family: var(--font-display);
  }
  .body {
    padding: 22px 28px 26px;
    display: grid;
    gap: 18px;
    position: relative;
    z-index: 1;
  }
  .msg {
    line-height: 1.65;
    color: var(--text);
    font-size: 1.02rem;
  }
  .meta {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
  .tile {
    background: linear-gradient(160deg, rgba(15, 23, 42, 0.7), rgba(9, 14, 18, 0.7));
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 14px;
    padding: 14px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    animation: fadeUp 380ms ease both;
  }
  .tile:nth-child(2) { animation-delay: 40ms; }
  .tile:nth-child(3) { animation-delay: 80ms; }
  .tile:nth-child(4) { animation-delay: 120ms; }
  .tile:nth-child(5) { animation-delay: 160ms; }
  .tile:nth-child(6) { animation-delay: 200ms; }
  @keyframes fadeUp {
    from { transform: translateY(6px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .k {
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .v {
    margin-top: 6px;
    font-size: 0.98rem;
    font-weight: 600;
    word-break: break-word;
  }
  .footer {
    border-top: 1px solid rgba(148, 163, 184, 0.16);
    padding: 14px 28px 18px;
    color: var(--muted);
    font-size: 0.84rem;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
  }
  @media (max-width: 640px) {
    body { padding: 18px; }
    .head, .body, .footer { padding-left: 20px; padding-right: 20px; }
    .title { font-size: 1.3rem; }
    .status { padding: 5px 10px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card, .tile, .orb { animation: none; }
  }
`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, tone, message, details = [] }) {
  const colorMap = {
    ok: '#22c55e',
    warn: '#f59e0b',
    err: '#ef4444',
    info: '#38bdf8'
  };
  const toneLabelMap = {
    ok: 'Verified',
    warn: 'Review',
    err: 'Action Required',
    info: 'Update'
  };
  const color = colorMap[tone] || colorMap.info;
  const statusLabel = toneLabelMap[tone] || toneLabelMap.info;
  const tiles = details
    .filter((x) => x.value !== undefined && x.value !== null && x.value !== '')
    .map((x) => `
      <div class="tile">
        <div class="k">${escapeHtml(x.label)}</div>
        <div class="v">${escapeHtml(x.value)}</div>
      </div>
    `)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles}</style>
</head>
<body>
  <canvas id="shader-bg" class="bg-canvas" aria-hidden="true"></canvas>
  <div class="orb orb-a" aria-hidden="true"></div>
  <div class="orb orb-b" aria-hidden="true"></div>
  <main class="card" style="--accent:${color}">
    <section class="head">
      <div class="head-row">
        <div class="brand">Discord Verify</div>
        <div class="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span>${escapeHtml(statusLabel)}</span>
        </div>
      </div>
      <div class="title">${escapeHtml(title)}</div>
    </section>
    <section class="body">
      <div class="msg">${escapeHtml(message)}</div>
      ${tiles ? `<div class="meta">${tiles}</div>` : ''}
    </section>
    <section class="footer">
      <span>Discord Verification Security Portal</span>
      <span>${escapeHtml(new Date().toISOString())}</span>
    </section>
  </main>
  <script id="shader-vs" type="x-shader/x-vertex">
attribute vec4 aVertexPosition;
void main() {
  gl_Position = aVertexPosition;
}
  </script>
  <script id="shader-fs" type="x-shader/x-fragment">
precision highp float;
uniform vec2 iResolution;
uniform float iTime;

  const float overallSpeed = 0.16;
const float gridSmoothWidth = 0.015;
const float axisWidth = 0.05;
const float majorLineWidth = 0.025;
const float minorLineWidth = 0.0125;
const float majorLineFrequency = 5.0;
const float minorLineFrequency = 1.0;
const vec4 gridColor = vec4(0.5);
const float scale = 5.0;
  const vec4 lineColor = vec4(0.2, 0.8, 0.6, 1.0);
const float minLineWidth = 0.01;
const float maxLineWidth = 0.2;
const float lineSpeed = 1.0 * overallSpeed;
const float lineAmplitude = 1.0;
const float lineFrequency = 0.2;
const float warpSpeed = 0.2 * overallSpeed;
const float warpFrequency = 0.5;
const float warpAmplitude = 1.0;
const float offsetFrequency = 0.5;
const float offsetSpeed = 1.33 * overallSpeed;
const float minOffsetSpread = 0.6;
const float maxOffsetSpread = 2.0;
const int linesPerGroup = 16;

#define drawCircle(pos, radius, coord) smoothstep(radius + gridSmoothWidth, radius, length(coord - (pos)))
#define drawSmoothLine(pos, halfWidth, t) smoothstep(halfWidth, 0.0, abs(pos - (t)))
#define drawCrispLine(pos, halfWidth, t) smoothstep(halfWidth + gridSmoothWidth, halfWidth, abs(pos - (t)))
#define drawPeriodicLine(freq, width, t) drawCrispLine(freq / 2.0, width, abs(mod(t, freq) - (freq) / 2.0))

float drawGridLines(float axis) {
  return drawCrispLine(0.0, axisWidth, axis)
        + drawPeriodicLine(majorLineFrequency, majorLineWidth, axis)
        + drawPeriodicLine(minorLineFrequency, minorLineWidth, axis);
}

float drawGrid(vec2 space) {
  return min(1.0, drawGridLines(space.x) + drawGridLines(space.y));
}

float random(float t) {
  return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
}

float getPlasmaY(float x, float horizontalFade, float offset) {
  return random(x * lineFrequency + iTime * lineSpeed) * horizontalFade * lineAmplitude + offset;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec4 fragColor;
  vec2 uv = fragCoord.xy / iResolution.xy;
  vec2 space = (fragCoord - iResolution.xy / 2.0) / iResolution.x * 2.0 * scale;

  float horizontalFade = 1.0 - (cos(uv.x * 6.28) * 0.5 + 0.5);
  float verticalFade = 1.0 - (cos(uv.y * 6.28) * 0.5 + 0.5);

  space.y += random(space.x * warpFrequency + iTime * warpSpeed) * warpAmplitude * (0.5 + horizontalFade);
  space.x += random(space.y * warpFrequency + iTime * warpSpeed + 2.0) * warpAmplitude * horizontalFade;

  vec4 lines = vec4(0.0);
  vec4 bgColor1 = vec4(0.04, 0.1, 0.12, 1.0);
  vec4 bgColor2 = vec4(0.08, 0.12, 0.1, 1.0);

  for(int l = 0; l < linesPerGroup; l++) {
    float normalizedLineIndex = float(l) / float(linesPerGroup);
    float offsetTime = iTime * offsetSpeed;
    float offsetPosition = float(l) + space.x * offsetFrequency;
    float rand = random(offsetPosition + offsetTime) * 0.5 + 0.5;
    float halfWidth = mix(minLineWidth, maxLineWidth, rand * horizontalFade) / 2.0;
    float offset = random(offsetPosition + offsetTime * (1.0 + normalizedLineIndex)) * mix(minOffsetSpread, maxOffsetSpread, horizontalFade);
    float linePosition = getPlasmaY(space.x, horizontalFade, offset);
    float line = drawSmoothLine(linePosition, halfWidth, space.y) / 2.0 + drawCrispLine(linePosition, halfWidth * 0.15, space.y);

    float circleX = mod(float(l) + iTime * lineSpeed, 25.0) - 12.0;
    vec2 circlePosition = vec2(circleX, getPlasmaY(circleX, horizontalFade, offset));
    float circle = drawCircle(circlePosition, 0.01, space) * 4.0;

    line = line + circle;
    lines += line * lineColor * rand;
  }

  fragColor = mix(bgColor1, bgColor2, uv.x);
  fragColor *= verticalFade;
  fragColor.a = 1.0;
  fragColor += lines;

  gl_FragColor = fragColor;
}
  </script>
  <script>
    (function initShaderBackground() {
      var canvas = document.getElementById('shader-bg');
      if (!canvas) return;
      var gl = canvas.getContext('webgl', { antialias: false, alpha: false });
      if (!gl) return;

      function loadShader(type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      }

      function initShaderProgram(vsSource, fsSource) {
        var vertexShader = loadShader(gl.VERTEX_SHADER, vsSource);
        var fragmentShader = loadShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vertexShader || !fragmentShader) return null;

        var shaderProgram = gl.createProgram();
        gl.attachShader(shaderProgram, vertexShader);
        gl.attachShader(shaderProgram, fragmentShader);
        gl.linkProgram(shaderProgram);

        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
          return null;
        }
        return shaderProgram;
      }

      var vsSource = document.getElementById('shader-vs').textContent;
      var fsSource = document.getElementById('shader-fs').textContent;
      var shaderProgram = initShaderProgram(vsSource, fsSource);
      if (!shaderProgram) return;

      var positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
         1.0,  1.0
      ]), gl.STATIC_DRAW);

      var positionLocation = gl.getAttribLocation(shaderProgram, 'aVertexPosition');
      var resolutionLocation = gl.getUniformLocation(shaderProgram, 'iResolution');
      var timeLocation = gl.getUniformLocation(shaderProgram, 'iTime');

      function resizeCanvas() {
        var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        var width = Math.floor(window.innerWidth * dpr);
        var height = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          canvas.style.width = window.innerWidth + 'px';
          canvas.style.height = window.innerHeight + 'px';
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      var start = performance.now();
      function render(now) {
        var currentTime = (now - start) / 1000;
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(shaderProgram);

        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform1f(timeLocation, currentTime);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(positionLocation);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
      }

      requestAnimationFrame(render);
    })();
  </script>
</body>
</html>`;
}

function maskIp(rawIp) {
  const ip = String(rawIp || 'Unknown');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 2).join(':')}:*:*`;
  }
  return 'Unknown';
}

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
      res.status(400).send(renderPage({
        title: 'Invalid Verification Callback',
        tone: 'err',
        message: 'Missing authorization parameters. Please restart verification from Discord.'
      }));
      return;
    }

    const session = getSessionFromState(String(state));
    if (!session) {
      res.status(400).send(renderPage({
        title: 'Session Expired',
        tone: 'warn',
        message: 'Your verification session expired. Please click Verify again from Discord.'
      }));
      return;
    }

    try {
      const tokenData = await exchangeCode(String(code));
      const discordUser = await fetchDiscordUser(tokenData.access_token);
      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + (Number(tokenData.expires_in) * 1000)).toISOString()
        : null;

      upsertOauthUser(discordUser.id, {
        username: `${discordUser.username}#${discordUser.discriminator || '0'}`,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || null,
        expiresAt
      });

      const guild = await client.guilds.fetch(session.guild_id);
      let member = await guild.members.fetch(discordUser.id).catch(() => null);

      if (!member) {
        await guild.members.add(discordUser.id, { accessToken: tokenData.access_token }).catch(() => null);
        member = await guild.members.fetch(discordUser.id).catch(() => null);
      }

      if (!member) {
        res.status(403).send(renderPage({
          title: 'Server Join Required',
          tone: 'warn',
          message: 'We could not add your account to the server automatically. Join the server first, then retry verification.'
        }));
        return;
      }

      const fp = await evaluateFingerprint(guild.id, member.id, req);
      const geoLine = fp.geo
        ? `${fp.geo.city}, ${fp.geo.region}, ${fp.geo.country}`
        : 'Unavailable';
      const mapUrl = fp.locationMapUrl || 'Unavailable';
      const maskedIp = maskIp(fp.rawIp);

      if (fp.duplicateUsers.length > 0) {
        upsertVerificationState(guild.id, member.id, {
          status: 'manual_review',
          last_reason: `duplicate_fingerprint:${fp.duplicateUsers.join(',')}`
        });

        await logEvent(guild, 'Manual Review: Alt Risk', [
          { name: 'User', value: `<@${member.id}>`, inline: true },
          { name: 'Matched Users', value: fp.duplicateUsers.map((id) => `<@${id}>`).join(', ') || 'None' },
          { name: 'IP', value: fp.rawIp, inline: true },
          { name: 'Country', value: fp.geo?.country || 'Unknown', inline: true },
          { name: 'Location', value: geoLine, inline: true },
          { name: 'ISP', value: fp.geo?.isp || 'Unknown', inline: true },
          { name: 'Browser', value: fp.browser || 'Unknown', inline: true },
          { name: 'Device Hash', value: `\`${fp.deviceHash.slice(0, 16)}...\`` },
          { name: 'Map', value: mapUrl }
        ], 0xfee75c, {
          description: 'Potential alternate account detected by shared IP/device fingerprint.',
          imageUrl: fp.locationMapUrl || undefined,
          footer: fp.geo?.timezone ? `Timezone: ${fp.geo.timezone}` : undefined
        });

        res.status(200).send(renderPage({
          title: 'Verification Pending Review',
          tone: 'warn',
          message: 'Security checks flagged this attempt for manual staff review. Your role will be granted once approved.',
          details: [
            { label: 'Status', value: 'Manual Review Required' },
            { label: 'Reason', value: 'Matched existing security fingerprint' },
            { label: 'User', value: `${discordUser.username}#${discordUser.discriminator || '0'}` },
            { label: 'Server', value: guild.name },
            { label: 'IP', value: maskedIp },
            { label: 'Browser', value: fp.browser || 'Unknown' }
          ]
        }));
        return;
      }

      await finalizeMemberVerification(guild, member, 'Website OAuth + fingerprint checks passed');
      await logEvent(guild, 'Website Verification Passed', [
        { name: 'User', value: `<@${member.id}>`, inline: true },
        { name: 'IP', value: fp.rawIp, inline: true },
        { name: 'Country', value: fp.geo?.country || 'Unknown', inline: true },
        { name: 'Location', value: geoLine, inline: true },
        { name: 'ISP', value: fp.geo?.isp || 'Unknown', inline: true },
        { name: 'Browser', value: fp.browser || 'Unknown', inline: true },
        { name: 'ASN', value: fp.geo?.asn || 'Unknown', inline: true },
        { name: 'Map', value: mapUrl }
      ], 0x22c55e, {
        description: 'User passed website OAuth verification and security checks.',
        imageUrl: fp.locationMapUrl || undefined,
        footer: fp.geo?.timezone ? `Timezone: ${fp.geo.timezone}` : undefined
      });

      res.setHeader('Set-Cookie', makeCookie('verified', '1', 3600));
      res.status(200).send(renderPage({
        title: 'Verification Complete',
        tone: 'ok',
        message: 'Your identity has been verified successfully. Your Discord role has been assigned and you can return to the server.',
        details: [
          { label: 'Account', value: `${discordUser.username}#${discordUser.discriminator || '0'}` },
          { label: 'Server', value: guild.name },
          { label: 'Session Security', value: fp.duplicateUsers.length ? 'Review Required' : 'Passed' },
          { label: 'IP', value: maskedIp },
          { label: 'Browser', value: fp.browser || 'Unknown' }
        ]
      }));
    } catch (error) {
      res.status(500).send(renderPage({
        title: 'Verification Failed',
        tone: 'err',
        message: 'Something went wrong while processing verification. Please retry in a moment.'
      }));
    }
  });

  app.listen(config.port, () => {
    console.log(`Web verification server running on :${config.port}`);
  });
}

module.exports = {
  startWebServer
};
