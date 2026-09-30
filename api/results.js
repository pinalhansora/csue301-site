// Student view of their own marks. Locked until a coordinator switches "release" on in the portal.
// Requires team ID + enrollment number + the team access code. Mentor comments are never returned.
const L = require("./_lib.js");
const { codeMatches } = require("./_code.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!L.sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });
    if (!process.env.MONGODB_URI || !process.env.TEAM_CODE_SECRET) {
      return res.status(500).json({ error: "Server is not configured." });
    }

    const b = L.readBody(req);
    const teamId = L.clean(b.teamId, 20).toUpperCase();
    const enrollment = L.clean(b.enrollment, 20).toUpperCase();
    const code = L.clean(b.code, 20);

    const team = L.findTeam(teamId);
    if (!team || !team.members.some((m) => m.id === enrollment)) {
      return res.status(403).json({ error: "This enrollment number is not a member of the selected team." });
    }

    const db = await L.getDb();
    const key = "results|" + teamId + "|" + L.clientIp(req);
    if (await L.isLimited(db, key)) {
      return res.status(429).json({ error: "Too many wrong codes. Please wait 15 minutes and try again." });
    }
    if (!code || !codeMatches(teamId, code, process.env.TEAM_CODE_SECRET)) {
      await L.recordFail(db, key);
      return res.status(403).json({ error: "Incorrect team access code." });
    }
    await L.clearFails(db, key);

    const settings = (await db.collection("settings").findOne({ _id: "marks" })) || {};
    if (!settings.released) return res.status(403).json({ error: "Marks have not been released yet." });

    const docs = await db.collection("marks").find({ teamId }).toArray();
    const byWeek = {};
    docs.forEach((d) => { byWeek[d.weekKey] = d.marks ? d.marks[enrollment] : null; });
    const weeks = L.WEEKS.map((w) => ({ key: w.key, label: w.label, marks: byWeek[w.key] ?? null }));
    const total = weeks.reduce((s, w) => s + (typeof w.marks === "number" ? w.marks : 0), 0);
    return res.status(200).json({ max: L.WEEKS.length * L.MAX_MARKS, total, weeks });
  } catch (err) {
    console.error("results error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
};
