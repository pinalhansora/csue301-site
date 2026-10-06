// Shared helpers for the mentor portal (files starting with "_" are not public routes on Vercel).
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const STAFF = require("./_staff.json");
const ROSTER = require("./_roster.json");

// ---- marking scheme ----
const MAX_MARKS = 5;   // per entry
const STEP = 0.5;      // allowed increments (0, 0.5, 1 ... 5)
const WEEKS = [{ key: "W1-3", label: "Weeks 1\u20133 (combined)" }].concat(
  Array.from({ length: 9 }, (_, i) => ({ key: "W" + (i + 4), label: "Week " + (i + 4) }))
); // 10 entries x 5 = 50 marks

// ---- database ----
async function getDb() {
  if (!global._mtPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    global._mtPromise = client.connect().then(async (c) => {
      const db = c.db(process.env.MONGODB_DB || "project_i");
      await db.collection("marks").createIndex({ teamId: 1, weekKey: 1 }, { unique: true });
      await db.collection("marks_log").createIndex({ teamId: 1, at: -1 });
      await db.collection("edit_attempts").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      return db;
    });
  }
  try { return await global._mtPromise; } catch (e) { global._mtPromise = null; throw e; }
}

// ---- staff / roster ----
function staffByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const s = STAFF.find((x) => x.email.toLowerCase() === e);
  return s ? { email: s.email.toLowerCase(), name: s.name, role: s.role, mentorKey: s.mentorKey || null } : null;
}
function teamsFor(user) {
  if (user.role === "super") return ROSTER;
  return ROSTER.filter((t) => user.mentorKey && t.mentorKey === user.mentorKey);
}
const findTeam = (teamId) => ROSTER.find((t) => t.teamId === teamId);

// ---- signed session cookie (no extra libraries) ----
const COOKIE = "pm_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const b64u = (s) => Buffer.from(s).toString("base64url");
const sign = (p) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(p).digest("base64url");

function makeToken(email) {
  const p = b64u(JSON.stringify({ e: email, x: Date.now() + TTL_MS }));
  return p + "." + sign(p);
}
function readToken(tok) {
  if (!tok || !process.env.SESSION_SECRET) return null;
  const [p, s] = String(tok).split(".");
  if (!p || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(sign(p));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString());
    return d.x && d.x > Date.now() ? d.e : null;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  });
  return out;
}
// Role is looked up from the staff list on EVERY request, so removing someone from _staff.json cuts access.
const currentUser = (req) => {
  const email = readToken(parseCookies(req)[COOKIE]);
  return email ? staffByEmail(email) : null;
};
const setSessionCookie = (res, token) =>
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_MS / 1000}`);
const clearSessionCookie = (res) =>
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

// ---- small utilities ----
const clean = (v, max) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
function readBody(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

// ---- wrong-code rate limit (shared with project.js's collection) ----
const MAX_FAILS = 8, WINDOW_MS = 15 * 60 * 1000;
async function isLimited(db, key) {
  const col = db.collection("edit_attempts");
  const rec = await col.findOne({ _id: key });
  const now = new Date();
  if (rec && rec.expireAt <= now) { await col.deleteOne({ _id: key }); return false; }
  return !!(rec && rec.count >= MAX_FAILS);
}
const recordFail = (db, key) =>
  db.collection("edit_attempts").updateOne(
    { _id: key },
    { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(Date.now() + WINDOW_MS) } },
    { upsert: true }
  );
const clearFails = (db, key) => db.collection("edit_attempts").deleteOne({ _id: key });

module.exports = {
  MAX_MARKS, STEP, WEEKS, ROSTER, getDb, staffByEmail, teamsFor, findTeam,
  makeToken, currentUser, setSessionCookie, clearSessionCookie, sameOrigin,
  clean, clientIp, readBody, isLimited, recordFail, clearFails,
};
