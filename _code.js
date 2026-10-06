// Derives each team's access code from a secret that lives ONLY in Vercel env vars.
// Nothing is stored in the repo or database, so codes cannot be read from GitHub.
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I confusion

function teamCode(teamId, secret) {
  const h = crypto.createHmac("sha256", secret).update(String(teamId)).digest();
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[h[i] % 32]; // 256 % 32 === 0, so unbiased
  return out.slice(0, 4) + "-" + out.slice(4);
}

const normalize = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Optional per-team overrides (used when a team's code must be reset, e.g. mentor change).
// Set in Vercel as TEAM_CODE_OVERRIDES = {"CS26011":"P6FN-NB7R", ...}
// If a team has an override, ONLY the override works; its derived code stops working.
function overrideFor(teamId) {
  try {
    const o = JSON.parse(process.env.TEAM_CODE_OVERRIDES || "{}");
    const v = o[String(teamId).toUpperCase()];
    return v ? String(v) : null;
  } catch (e) {
    return null;
  }
}

function codeMatches(teamId, given, secret) {
  const expected = overrideFor(teamId) || teamCode(teamId, secret);
  const a = Buffer.from(normalize(expected));
  const b = Buffer.from(normalize(given));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { teamCode, codeMatches };
