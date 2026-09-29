const { MongoClient } = require("mongodb");
const TEAMS = require("./_teams.json"); // { teamId: [enrollment ids] }
const { codeMatches } = require("./_code.js");

const MAX_FAILS = 8;                 // wrong codes allowed ...
const WINDOW_MS = 15 * 60 * 1000;    // ... per 15 minutes, per team + IP

// Reuse one connection across warm serverless invocations
async function getCollections() {
  if (!global._pdPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
    });
    global._pdPromise = client.connect().then(async (c) => {
      const db = c.db(process.env.MONGODB_DB || "project_i");
      const defs = db.collection("project_definitions");
      const attempts = db.collection("edit_attempts");
      await defs.createIndex({ teamId: 1 }, { unique: true });
      await attempts.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      return { defs, attempts };
    });
  }
  try {
    return await global._pdPromise;
  } catch (e) {
    global._pdPromise = null; // allow retry on next request
    throw e;
  }
}

const clean = (v, max) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: "Server is not configured (MONGODB_URI missing)." });
    }
    const { defs, attempts } = await getCollections();

    // ---------- GET: all submitted definitions (public fields only) ----------
    if (req.method === "GET") {
      const items = await defs
        .find({}, { projection: { _id: 0, teamId: 1, title: 1, definition: 1, updatedAt: 1 } })
        .limit(500)
        .toArray();
      return res.status(200).json({ items });
    }

    // ---------- POST: create / replace a team's definition ----------
    if (req.method === "POST") {
      const secret = process.env.TEAM_CODE_SECRET;
      if (!secret) {
        return res.status(500).json({ error: "Server is not configured (TEAM_CODE_SECRET missing)." });
      }

      let b = req.body;
      if (typeof b === "string") {
        try { b = JSON.parse(b); } catch { b = {}; }
      }
      b = b || {};

      const teamId = clean(b.teamId, 20).toUpperCase();
      const enrollment = clean(b.enrollment, 20).toUpperCase();
      const code = clean(b.code, 20);
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

      // --- brute-force protection ---
      const key = teamId + "|" + clientIp(req);
      const now = new Date();
      const rec = await attempts.findOne({ _id: key });
      if (rec && rec.expireAt <= now) await attempts.deleteOne({ _id: key });
      else if (rec && rec.count >= MAX_FAILS) {
        return res.status(429).json({ error: "Too many wrong codes. Please wait 15 minutes and try again." });
      }

      // --- team access code check ---
      if (!code || !codeMatches(teamId, code, secret)) {
        await attempts.updateOne(
          { _id: key },
          { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(now.getTime() + WINDOW_MS) } },
          { upsert: true }
        );
        return res.status(403).json({ error: "Incorrect team access code." });
      }
      await attempts.deleteOne({ _id: key });

      await defs.updateOne(
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
