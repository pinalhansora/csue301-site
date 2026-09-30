// Sign-in with Google. Only e-mail addresses listed in api/_staff.json get a session.
const { OAuth2Client } = require("google-auth-library");
const L = require("./_lib.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    // The Google client ID is public; the page asks for it so it never has to be hard-coded.
    if (req.method === "GET") {
      return res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID || "" });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!L.sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });

    const b = L.readBody(req);

    if (b.logout) {
      L.clearSessionCookie(res);
      return res.status(200).json({ ok: true });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.SESSION_SECRET) {
      return res.status(500).json({ error: "Server is not configured (GOOGLE_CLIENT_ID / SESSION_SECRET missing)." });
    }
    const credential = L.clean(b.credential, 5000);
    if (!credential) return res.status(400).json({ error: "Missing Google credential." });

    let payload;
    try {
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: "Google sign-in could not be verified. Please try again." });
    }
    if (!payload || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: "Your Google e-mail is not verified." });
    }

    const user = L.staffByEmail(payload.email);
    if (!user) {
      return res.status(403).json({ error: "The account " + payload.email + " is not authorised for the mentor portal." });
    }

    L.setSessionCookie(res, L.makeToken(user.email));
    return res.status(200).json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error("auth error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
};
