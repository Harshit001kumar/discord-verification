const DAY = 24 * 60 * 60 * 1000;

function accountAgeDays(user) {
  return Math.floor((Date.now() - user.createdTimestamp) / DAY);
}

function calculateRisk({ user, minAccountAgeDays, failedAttempts }) {
  const age = accountAgeDays(user);
  let score = 0;
  let reasons = [];

  if (age < 1) {
    score += 70;
    reasons.push('Account younger than 1 day');
  } else if (age < minAccountAgeDays) {
    score += 35;
    reasons.push(`Account younger than minimum (${minAccountAgeDays}d)`);
  }

  if (failedAttempts >= 1) {
    score += Math.min(30, failedAttempts * 10);
    reasons.push(`Prior failed challenges: ${failedAttempts}`);
  }

  const suspiciousUsername = /free|nitro|gift|crypto|airdrop|drop/i.test(user.username);
  if (suspiciousUsername) {
    score += 20;
    reasons.push('Suspicious username pattern');
  }

  return {
    score,
    reasons,
    ageDays: age,
    level: score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low'
  };
}

module.exports = {
  calculateRisk,
  accountAgeDays
};
