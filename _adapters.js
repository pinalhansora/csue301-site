// Shared helpers for industry.js and attachments.js (wired to your existing _lib.js, _teams.json, _code.js)
const L = require("./_lib.js");
const TEAMS = require("./_teams.json");            // { teamId: [enrollment ids] }  (same file project.js uses)
const { codeMatches } = require("./_code.js");

const MAX_FAILS = 8, WINDOW_MS = 15 * 60 * 1000;   // same limits as project.js

async function getCollections() {
  if (!global._extrasIdx) {
    global._extrasIdx = (async () => {
      const db = await L.getDb();
      const extras = db.collection("project_extras");      // NEW: industryType + file links per team
      const attempts = db.collection("file_attempts");     // NEW: lockout counter for wrong codes on uploads
      await extras.createIndex({ teamId: 1 }, { unique: true });
      await attempts.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      return { extras, attempts };
    })();
  }
  try { return await global._extrasIdx; }
  catch (e) { global._extrasIdx = null; throw e; }
}

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

// Student side: team access code (same HMAC code as the Project-1 form) + lockout after 8 wrong tries
async function checkTeamCode(req, teamIdRaw, code) {
  const teamId = String(teamIdRaw || "").toUpperCase();
  if (!TEAMS[teamId]) return { ok: false, status: 400, error: "Unknown team ID." };
  const secret = process.env.TEAM_CODE_SECRET;
  if (!secret) return { ok: false, status: 500, error: "Server is not configured." };
  const { attempts } = await getCollections();
  const key = teamId + "|" + clientIp(req), now = new Date();
  const rec = await attempts.findOne({ _id: key });
  if (rec && rec.expireAt <= now) await attempts.deleteOne({ _id: key });
  else if (rec && rec.count >= MAX_FAILS)
    return { ok: false, status: 429, error: "Too many wrong codes. Please wait 15 minutes." };
  if (!code || !codeMatches(teamId, String(code), secret)) {
    await attempts.updateOne({ _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(now.getTime() + WINDOW_MS) } }, { upsert: true });
    return { ok: false, status: 403, error: "Incorrect team access code." };
  }
  await attempts.deleteOne({ _id: key });
  return { ok: true, teamId };
}

// Mentor / coordinator side: the same signed session cookie as /api/mentor
async function getMentorSession(req) {
  return L.currentUser(req) || null;               // { email, name, role: 'super'|'mentor', mentorKey }
}
// Coordinators ('super') = all 56 teams; mentors = only the teams L.teamsFor() gives them
function canAccessTeam(session, teamId) {
  if (!session) return false;
  return L.teamsFor(session).some((t) => t.teamId === String(teamId).toUpperCase());
}

module.exports = { L, TEAMS, getCollections, checkTeamCode, getMentorSession, canAccessTeam };
