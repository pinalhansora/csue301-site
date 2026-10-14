// Student file uploads (Weekly Report PDF + PPT) via Vercel Blob client uploads.
// Needs: npm i @vercel/blob   and a Blob store connected to the project (BLOB_READ_WRITE_TOKEN).
//
// POST {type:'blob.generate-client-token', ...}  -> handled by handleUpload (token step)
//      clientPayload = JSON {teamId, code, kind:'report'|'ppt'}
// POST {action:'save', teamId, code, kind, url, name} -> store link in MongoDB
// GET  ?teamId=CS26040  (mentor/coordinator session) -> links for that team
const { handleUpload } = require('@vercel/blob/client');
const A = require('./_adapters');

const KINDS = {
  report: { field: 'weeklyReport', max: 30 * 1024 * 1024,
            types: ['application/pdf'] },
  ppt:    { field: 'presentation', max: 30 * 1024 * 1024,
            types: ['application/vnd.ms-powerpoint',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
};

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const s = await A.getMentorSession(req);
      const teamId = req.query.teamId;
      if (!s || !A.canMentorEditTeam(s, teamId)) return res.status(403).json({ error: 'Forbidden' });
      const d = await (await A.getDb()).collection(A.TEAMS_COLLECTION)
        .findOne({ [A.TEAM_ID_FIELD]: teamId }, { projection: { weeklyReport: 1, presentation: 1 } });
      return res.json({ weeklyReport: d?.weeklyReport || null, presentation: d?.presentation || null });
    }
    if (req.method !== 'POST') return res.status(405).end();
    const body = req.body || {};

    if (body.action === 'save') {
      const { teamId, code, kind, url, name } = body;
      const k = KINDS[kind];
      if (!k || !(await A.verifyTeamCode(teamId, code))) return res.status(403).json({ error: 'Invalid access code' });
      if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url || ''))
        return res.status(400).json({ error: 'Bad file URL' });
      await (await A.getDb()).collection(A.TEAMS_COLLECTION).updateOne(
        { [A.TEAM_ID_FIELD]: teamId },
        { $set: { [k.field]: { url, name: String(name || '').slice(0, 200), at: new Date() } } },
        { upsert: true });
      return res.json({ ok: true });
    }

    // token step
    const json = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { teamId, code, kind } = JSON.parse(clientPayload || '{}');
        const k = KINDS[kind];
        if (!k || !(await A.verifyTeamCode(teamId, code))) throw new Error('Invalid access code');
        return { allowedContentTypes: k.types, maximumSizeInBytes: k.max, addRandomSuffix: true };
      },
      onUploadCompleted: async () => {}, // link is saved by the 'save' action above
    });
    res.json(json);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message || 'Upload error' }); }
};
