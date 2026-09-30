// Run LOCALLY. Builds send-codes.html: one page where you click a button per student/team
// and WhatsApp opens with the team's code already typed in - you only press Send.
//
//   Windows (PowerShell):
//     $env:TEAM_CODE_SECRET='your-secret'
//     $env:SITE_URL='https://your-site.vercel.app'      (optional, added to the message)
//     node scripts/make-send-page.js
//
//   Mac/Linux:
//     TEAM_CODE_SECRET='your-secret' SITE_URL='https://your-site.vercel.app' node scripts/make-send-page.js
//
// send-codes.html contains codes and phone numbers: keep it on your computer, never upload it to GitHub.
const fs = require("fs");
const path = require("path");
const { teamCode } = require("../api/_code.js");

const secret = process.env.TEAM_CODE_SECRET;
if (!secret) { console.error("Set TEAM_CODE_SECRET first (same value as in Vercel)."); process.exit(1); }
const siteUrl = (process.env.SITE_URL || "").trim();

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/const PROJECT1_TEAMS = (\[[\s\S]*?\]);\n/);
if (!m) { console.error("Could not find PROJECT1_TEAMS in index.html"); process.exit(1); }
const teams = JSON.parse(m[1]);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function waNumber(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;                   // Indian mobile
  if (d.length === 12 && d.startsWith("91")) return d;
  return "";
}

function message(team, code) {
  return [
    "Hello,",
    "",
    "This is your Project-I team access code.",
    "Team: " + team.teamId,
    "Access code: " + code,
    "",
    "Use it on the PROJECT-1 page" + (siteUrl ? " (" + siteUrl + ")" : "") +
      " to submit your Problem Definition and Problem Description. Only your team can edit its entry, so please do not share this code outside your team.",
    "",
    "- Prof. Pinal M. Hansora",
  ].join("\n");
}

const cards = teams.map((t) => {
  const code = teamCode(t.teamId, secret);
  const msg = message(t, code);
  const buttons = t.members.map((mem) => {
    const num = waNumber(mem.phone);
    return num
      ? `<a class="wa" target="_blank" rel="noopener" href="https://wa.me/${num}?text=${encodeURIComponent(msg)}">WhatsApp ${esc(mem.name)}</a>`
      : `<span class="nophone">${esc(mem.name)}: no phone number</span>`;
  }).join("");
  return `
  <div class="card" data-search="${esc((t.teamId + " " + t.members.map((x) => x.name + " " + x.id).join(" ")).toLowerCase())}">
    <div class="top">
      <b>${esc(t.teamId)}</b>
      <span class="code">${esc(code)}</span>
      <label class="done"><input type="checkbox" data-team="${esc(t.teamId)}"> sent</label>
    </div>
    <div class="members">${t.members.map((x) => esc(x.name) + " (" + esc(x.id) + ")").join(" &middot; ")}</div>
    <div class="btns">${buttons}
      <button type="button" class="copy" data-msg="${esc(msg)}">Copy message (for a group)</button>
    </div>
  </div>`;
}).join("\n");

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send team codes</title>
<style>
 body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f5f6f8;margin:0;padding:20px;color:#1c2333}
 h1{font-size:20px;margin:0 0 4px} .note{color:#b42318;font-size:13px;margin:0 0 14px}
 #q{width:100%;max-width:420px;padding:10px 12px;border:1px solid #c9ced8;border-radius:8px;font-size:14px;margin-bottom:14px}
 .card{background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:12px 14px;margin-bottom:10px}
 .card.finished{opacity:.55}
 .top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
 .code{font-family:ui-monospace,Consolas,monospace;background:#eef6f5;color:#0f766e;padding:3px 9px;border-radius:6px;font-size:15px}
 .done{margin-left:auto;font-size:13px}
 .members{font-size:13px;color:#5b6472;margin:6px 0 8px}
 .btns{display:flex;gap:8px;flex-wrap:wrap}
 .wa{background:#16a34a;color:#fff;text-decoration:none;padding:7px 12px;border-radius:7px;font-size:13px}
 .copy{background:#fff;border:1px solid #0f766e;color:#0f766e;padding:7px 12px;border-radius:7px;font-size:13px;cursor:pointer}
 .nophone{font-size:12.5px;color:#8a919e;padding:7px 4px}
</style></head><body>
<h1>Send team access codes</h1>
<p class="note">Private page: it contains codes and phone numbers. Do not upload it anywhere.</p>
<input id="q" placeholder="Search team ID or student name / enrollment...">
${cards}
<script>
 const key = 'sentTeams';
 let sent = {}; try { sent = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
 document.querySelectorAll('input[type=checkbox]').forEach(cb => {
   cb.checked = !!sent[cb.dataset.team];
   const apply = () => cb.closest('.card').classList.toggle('finished', cb.checked);
   apply();
   cb.addEventListener('change', () => { sent[cb.dataset.team] = cb.checked; try { localStorage.setItem(key, JSON.stringify(sent)); } catch (e) {} apply(); });
 });
 document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', async () => {
   try { await navigator.clipboard.writeText(b.dataset.msg); b.textContent = 'Copied'; }
   catch (e) { prompt('Copy this message:', b.dataset.msg); }
   setTimeout(() => b.textContent = 'Copy message (for a group)', 1500);
 }));
 document.getElementById('q').addEventListener('input', e => {
   const v = e.target.value.trim().toLowerCase();
   document.querySelectorAll('.card').forEach(c => c.style.display = c.dataset.search.includes(v) ? '' : 'none');
 });
</script></body></html>`;

fs.writeFileSync("send-codes.html", page, "utf8");
console.log("Wrote send-codes.html for " + teams.length + " teams. Open it in your browser.");
