// POST { teamId, industryType }  -> mentor of that team or coordinator only
// GET  ?all=1                    -> mentor sees own teams, coordinator sees all
const A = require('./_adapters');
const TYPES = ['Full Stack','Cybersecurity','Core AI','Fullstack+AI','Cybersecurity+AI','Other'];

module.exports = async (req, res) => {
  try {
    const s = await A.getMentorSession(req);
    if (!s) return res.status(401).json({ error: 'Sign in required' });
    const col = (await A.getDb()).collection(A.TEAMS_COLLECTION);

    if (req.method === 'GET') {
      const docs = await col.find({}, { projection: { [A.TEAM_ID_FIELD]: 1, industryType: 1 } }).toArray();
      const out = docs.filter(d => A.canMentorEditTeam(s, d[A.TEAM_ID_FIELD]))
        .map(d => ({ teamId: d[A.TEAM_ID_FIELD], industryType: d.industryType || '' }));
      return res.json({ types: TYPES, teams: out });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const { teamId, industryType } = req.body || {};
    if (!TYPES.includes(industryType)) return res.status(400).json({ error: 'Invalid industry type' });
    if (!A.canMentorEditTeam(s, teamId)) return res.status(403).json({ error: 'Not your team' });

    await col.updateOne({ [A.TEAM_ID_FIELD]: teamId },
      { $set: { industryType, industryBy: s.email, industryAt: new Date() } }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
};
