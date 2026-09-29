// Run LOCALLY (never on the server) to get every team's access code.
//   Windows (PowerShell):  $env:TEAM_CODE_SECRET="your-secret"; node scripts/generate-codes.js
//   Mac/Linux:             TEAM_CODE_SECRET="your-secret" node scripts/generate-codes.js
// Writes team-codes.csv (teamId, members, code). Do NOT commit that file.
const fs = require("fs");
const path = require("path");
const { teamCode } = require("../api/_code.js");

const secret = process.env.TEAM_CODE_SECRET;
if (!secret) { console.error("Set TEAM_CODE_SECRET first (same value as in Vercel)."); process.exit(1); }

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/const PROJECT1_TEAMS = (\[[\s\S]*?\]);\n/);
if (!m) { console.error("Could not find PROJECT1_TEAMS in index.html"); process.exit(1); }
const teams = JSON.parse(m[1]);

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const rows = ["teamId,members,accessCode"];
for (const t of teams) {
  rows.push([t.teamId, q(t.members.map((x) => x.name + " (" + x.id + ")").join("; ")), teamCode(t.teamId, secret)].join(","));
}
fs.writeFileSync("team-codes.csv", rows.join("\n"), "utf8");
console.log("Wrote team-codes.csv with " + teams.length + " teams");
