// ============================================================
// WIRE THESE 4 FUNCTIONS TO YOUR EXISTING CODE (only file to edit)
// ============================================================
const { MongoClient } = require('mongodb');

let _client;
async function getDb() {
  if (!_client) _client = new MongoClient(process.env.MONGODB_URI); // <- use your existing env name
  await _client.connect();
  return _client.db(process.env.MONGODB_DB || undefined);           // <- your DB name if not in URI
}

// Collection that holds one doc per team (CS26040 etc.). Change if yours differs.
const TEAMS_COLLECTION = 'project1';
const TEAM_ID_FIELD = 'teamId';

// 1) Who is logged in on the mentor portal?
//    Return { email, isCoordinator, mentorKey } or null.
//    Reuse the SAME Google-token check your marks API already does.
async function getMentorSession(req) {
  // TODO: copy the verification used in your marks endpoint.
  // Coordinators = pinal + amit (from api/_staff.json).
  return null;
}

// 2) May this mentor touch this team?  (mentorKey in api/_roster.json)
function canMentorEditTeam(session, teamId) {
  if (!session) return false;
  if (session.isCoordinator) return true;
  const roster = require('./_roster.json'); // adjust shape if needed
  const rows = Array.isArray(roster) ? roster : (roster.teams || []);
  const t = rows.find(r => (r.id || r.teamId || r.code) === teamId);
  return !!t && t.mentorKey === session.mentorKey;
}

// 3) Does this access code belong to this team?  (HMAC logic in api/_code.js,
//    plus TEAM_CODE_OVERRIDES for the reset groups)
async function verifyTeamCode(teamId, code) {
  // TODO: call the same function your Project-1 form API uses to validate edits.
  return false;
}

module.exports = { getDb, TEAMS_COLLECTION, TEAM_ID_FIELD,
  getMentorSession, canMentorEditTeam, verifyTeamCode };
