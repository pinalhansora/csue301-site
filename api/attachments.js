// Student uploads (Weekly Report PDF + Presentation) through Vercel Blob client uploads.
// Needs: npm i @vercel/blob  + a Blob store connected to the Vercel project.
const { handleUpload } = require("@vercel/blob/client");
const A = require("./_adapters");

const KINDS = {
  report: { field: "weeklyReport", max: 30 * 1024 * 1024, types: ["application/pdf"] },
  ppt:    { field: "presentation", max: 30 * 1024 * 1024,
            types: ["application/vnd.ms-powerpoint",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
};
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    // ---- GET ?teamId=  : mentor/coordinator reads a team's file links ----
    if (req.method === "GET") {
      const s = await A.getMentorSession(req);
      const teamId = String(req.query.teamId || "").toUpperCase();
      if (!s || !A.canAccessTeam(s, teamId)) return res.status(403).json({ error: "Forbidden" });
      const { extras } = await A.getCollections();
      const d = await extras.findOne({ teamId }, { projection: { _id: 0, weeklyReport: 1, presentation: 1 } });
      return res.json({ weeklyReport: d?.weeklyReport || null, presentation: d?.presentation || null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } } body = body || {};

    // ---- POST action:save : student stores the link after the browser finished uploading ----
    if (body.action === "save") {
      const k = KINDS[body.kind];
      if (!k) return res.status(400).json({ error: "Bad file type." });
      const c = await A.checkTeamCode(req, body.teamId, body.code);
      if (!c.ok) return res.status(c.status).json({ error: c.error });
      if (!BLOB_URL.test(String(body.url || ""))) return res.status(400).json({ error: "Bad file URL." });
      const { extras } = await A.getCollections();
      await extras.updateOne({ teamId: c.teamId },
        { $set: { [k.field]: { url: body.url, name: String(body.name || "").slice(0, 200), at: new Date() } },
          $setOnInsert: { teamId: c.teamId } }, { upsert: true });
      return res.json({ ok: true });
    }

    // ---- POST (Vercel Blob handshake) : issue an upload token only for a valid team code ----
    const json = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const p = JSON.parse(clientPayload || "{}");
        const k = KINDS[p.kind];
        if (!k) throw new Error("Bad file type.");
        const c = await A.checkTeamCode(req, p.teamId, p.code);
        if (!c.ok) throw new Error(c.error);
        return { allowedContentTypes: k.types, maximumSizeInBytes: k.max, addRandomSuffix: true };
      },
      onUploadCompleted: async () => {},
    });
    res.json(json);
  } catch (e) { console.error("attachments api:", e); res.status(400).json({ error: e.message || "Upload error." }); }
};
