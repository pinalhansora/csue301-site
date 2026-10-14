// GET  -> { types, teams:[{teamId, industryType}] } for the teams this signed-in person may see
// POST { teamId, industryType } -> that team's mentor or a coordinator only. Students can never call this successfully.
const A = require("./_adapters");
const TYPES = ["Full Stack", "Cybersecurity", "Core AI", "Fullstack+AI", "Cybersecurity+AI", "Other"];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const s = await A.getMentorSession(req);
    if (!s) return res.status(401).json({ error: "Sign in required" });
    const { extras } = await A.getCollections();

    if (req.method === "GET") {
      const docs = await extras.find({}, { projection: { _id: 0, teamId: 1, industryType: 1 } }).toArray();
      return res.json({
        types: TYPES,
        teams: docs.filter(d => d.industryType && A.canAccessTeam(s, d.teamId))
                   .map(d => ({ teamId: d.teamId, industryType: d.industryType })),
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!A.L.sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });

    let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } } b = b || {};
    const teamId = String(b.teamId || "").toUpperCase();
    if (!A.TEAMS[teamId]) return res.status(400).json({ error: "Unknown team ID." });
    if (b.industryType !== "" && !TYPES.includes(b.industryType)) return res.status(400).json({ error: "Invalid industry type." });
    if (!A.canAccessTeam(s, teamId)) return res.status(403).json({ error: "Not your team." });

    await extras.updateOne({ teamId },
      { $set: { industryType: b.industryType, industryBy: s.email, industryAt: new Date() }, $setOnInsert: { teamId } },
      { upsert: true });
    res.json({ ok: true });
  } catch (e) { console.error("industry api:", e); res.status(500).json({ error: "Server error." }); }
};
