// Run LOCALLY whenever teams/mentors/members change in index.html:
//   node scripts/build-roster.js
// Reads PROJECT1_TEAMS from index.html and writes api/_roster.json
// (team ID, mentor key, members' enrollment numbers + names; NO phone numbers).
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/const PROJECT1_TEAMS = (\[[\s\S]*?\]);\n/);
if (!m) { console.error("Could not find PROJECT1_TEAMS in index.html"); process.exit(1); }
const teams = JSON.parse(m[1]);
const staff = require("../api/_staff.json");

const roster = teams.map((t) => ({
  teamId: String(t.teamId).trim().toUpperCase(),
  mentorKey: String(t.mentor || "").trim().toLowerCase(),
  members: t.members.map((x) => ({ id: String(x.id).trim().toUpperCase(), name: String(x.name).trim() })),
}));

fs.writeFileSync(path.join(__dirname, "..", "api", "_roster.json"), JSON.stringify(roster, null, 1));

const keys = new Set(staff.map((s) => s.mentorKey).filter(Boolean));
const counts = {};
roster.forEach((r) => { counts[r.mentorKey] = (counts[r.mentorKey] || 0) + 1; });
console.log("Wrote api/_roster.json with " + roster.length + " teams");
Object.entries(counts).forEach(([k, n]) => console.log("  " + k + ": " + n + " teams" + (keys.has(k) ? "" : "   <-- NO STAFF ENTRY FOR THIS MENTOR (edit api/_staff.json)")));
staff.filter((s) => s.mentorKey && !counts[s.mentorKey]).forEach((s) => console.log("  note: " + s.name + " has no teams assigned"));
