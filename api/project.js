const { MongoClient } = require("mongodb");
const TEAMS = require("./_teams.json"); // { teamId: [enrollment ids] } - used to verify who may edit

// Reuse one connection across warm serverless invocations
async function getCollection() {
  if (!global._pdClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    global._pdClientPromise = client.connect().then(async (c) => {
      const col = c.db(process.env.MONGODB_DB || "project_i").collection("project_definitions");
      await col.createIndex({ teamId: 1 }, { unique: true });
      return col;
    });
  }
  try {
    return await global._pdClientPromise;
  } catch (e) {
    global._pdClientPromise = null; // allow retry on next request
    throw e;
  }
}

const clean = (v, max) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: "Server is not configured (MONGODB_URI missing)." });
    }
    const col = await getCollection();

    // ---------- GET: all submitted definitions (public fields only) ----------
    if (req.method === "GET") {
      const items = await col
        .find({}, { projection: { _id: 0, teamId: 1, title: 1, definition: 1, updatedAt: 1 } })
        .limit(500)
        .toArray();
      return res.status(200).json({ items });
    }

    // ---------- POST: create / replace a team's definition ----------
    if (req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") {
        try { b = JSON.parse(b); } catch { b = {}; }
      }
      b = b || {};

      const teamId = clean(b.teamId, 20).toUpperCase();
      const enrollment = clean(b.enrollment, 20).toUpperCase();
      const title = clean(b.title, 150);
      const definition = clean(b.definition, 3000);

      const members = TEAMS[teamId];
      if (!members) return res.status(400).json({ error: "Unknown team ID." });
      if (!members.includes(enrollment)) {
        return res.status(403).json({ error: "This enrollment number is not a member of the selected team." });
      }
      if (definition.length < 30) {
        return res.status(400).json({ error: "Project definition must be at least 30 characters." });
      }

      const now = new Date();
      await col.updateOne(
        { teamId },
        {
          $set: { title, definition, updatedBy: enrollment, updatedAt: now },
          $setOnInsert: { teamId, createdAt: now },
        },
        { upsert: true }
      );
      return res.status(200).json({ ok: true, updatedAt: now });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("project api error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
};
