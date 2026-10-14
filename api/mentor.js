// Mentor / coordinator API: read assigned teams + marks, save weekly marks & comments, release switch.
const L = require("./_lib.js");

const weekKeys = new Set(L.WEEKS.map((w) => w.key));

// ---- weekly deadlines / locks (stored in settings as _id "lock:<weekKey>") ----
const lockIds = L.WEEKS.map((w) => "lock:" + w.key);
function lockState(doc, now) {
  const dl = doc && doc.deadline ? new Date(doc.deadline) : null;
  const unlocked = !!(doc && doc.unlocked);
  return { deadline: dl, unlocked, locked: !!(dl && now >= dl && !unlocked) };
}
async function loadLocks(db) {
  const docs = await db.collection("settings").find({ _id: { $in: lockIds } }).toArray();
  const now = new Date();
  const out = {};
  docs.forEach((d) => { out[String(d._id).slice(5)] = lockState(d, now); });
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!process.env.MONGODB_URI) return res.status(500).json({ error: "Server is not configured (MONGODB_URI missing)." });
    if (!process.env.SESSION_SECRET) return res.status(500).json({ error: "Server is not configured (SESSION_SECRET missing)." });

    const user = L.currentUser(req);
    if (!user) return res.status(401).json({ error: "Not signed in." });

    const db = await L.getDb();
    const marksCol = db.collection("marks");

    // ---------- GET: everything this person may see ----------
    if (req.method === "GET") {
      const teams = L.teamsFor(user);
      const ids = teams.map((t) => t.teamId);
      const docs = ids.length ? await marksCol.find({ teamId: { $in: ids } }).toArray() : [];
      const byTeam = {};
      docs.forEach((d) => {
        (byTeam[d.teamId] = byTeam[d.teamId] || {})[d.weekKey] = {
          marks: d.marks || {}, comment: d.comment || "", updatedBy: d.updatedBy || "", updatedAt: d.updatedAt || null,
        };
      });
      const settings = (await db.collection("settings").findOne({ _id: "marks" })) || {};
      return res.status(200).json({
        user: { email: user.email, name: user.name, role: user.role, mentorKey: user.mentorKey },
        weeks: L.WEEKS, maxMarks: L.MAX_MARKS, step: L.STEP,
        released: !!settings.released,
        locks: await loadLocks(db),
        teams: teams.map((t) => ({ teamId: t.teamId, mentorKey: t.mentorKey, members: t.members, entries: byTeam[t.teamId] || {} })),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!L.sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });

    const b = L.readBody(req);

    // ---------- POST release (coordinators only) ----------
    if (b.action === "release") {
      if (user.role !== "super") return res.status(403).json({ error: "Only coordinators can change this." });
      const released = b.released === true;
      await db.collection("settings").updateOne(
        { _id: "marks" },
        { $set: { released, updatedBy: user.email, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true, released });
    }

    // ---------- POST set / clear a week's deadline, lock or reopen (coordinators only) ----------
    if (b.action === "setlock") {
      if (user.role !== "super") return res.status(403).json({ error: "Only coordinators can change deadlines." });
      const weekKey = L.clean(b.weekKey, 10);
      if (!weekKeys.has(weekKey)) return res.status(400).json({ error: "Unknown week." });
      let deadline = null;
      if (b.deadline) {
        deadline = new Date(b.deadline);
        if (isNaN(deadline.getTime())) return res.status(400).json({ error: "Invalid date." });
      }
      const unlocked = b.unlocked === true;
      const now = new Date();
      await db.collection("settings").updateOne(
        { _id: "lock:" + weekKey },
        { $set: { deadline, unlocked, updatedBy: user.email, updatedAt: now } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true, lock: lockState({ deadline, unlocked }, now) });
    }

    // ---------- POST save marks + comment ----------
    if (b.action === "save") {
      const teamId = L.clean(b.teamId, 20).toUpperCase();
      const weekKey = L.clean(b.weekKey, 10);
      const team = L.findTeam(teamId);

      if (!team || !L.teamsFor(user).some((t) => t.teamId === teamId)) {
        return res.status(403).json({ error: "You are not allowed to mark this team." });
      }
      if (!weekKey || !weekKeys.has(weekKey)) return res.status(400).json({ error: "Unknown week." });
      if (user.role !== "super") {
        const locks = await loadLocks(db);
        if (locks[weekKey] && locks[weekKey].locked) {
          return res.status(403).json({ error: "This week is locked. Please ask the coordinator to reopen it." });
        }
      }

      const given = b.marks && typeof b.marks === "object" ? b.marks : {};
      const marks = {};
      for (const m of team.members) {
        const raw = given[m.id];
        if (raw === undefined || raw === null || raw === "") { marks[m.id] = null; continue; }
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > L.MAX_MARKS || Math.round(v / L.STEP) * L.STEP !== v) {
          return res.status(400).json({ error: "Marks for " + m.name + " must be between 0 and " + L.MAX_MARKS + " in steps of " + L.STEP + "." });
        }
        marks[m.id] = v;
      }
      const comment = L.clean(b.comment, 1000);
      const now = new Date();

      await marksCol.updateOne(
        { teamId, weekKey },
        { $set: { marks, comment, updatedBy: user.email, updatedAt: now }, $setOnInsert: { teamId, weekKey, createdAt: now } },
        { upsert: true }
      );
      // append-only history of every save (who, when, what)
      await db.collection("marks_log").insertOne({ teamId, weekKey, marks, comment, by: user.email, at: now });

      return res.status(200).json({ ok: true, entry: { marks, comment, updatedBy: user.email, updatedAt: now } });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("mentor api error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
};
