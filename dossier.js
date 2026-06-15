// Vercel serverless function — /api/dossier
//   GET  /api/dossier?id=abc123        → public read (clients open this)
//   POST /api/dossier  (Bearer EDITOR_TOKEN) → create/update, returns short id
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server only — never exposed to the browser)
//   EDITOR_TOKEN                (a secret you choose, required to publish)

const SB = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.EDITOR_TOKEN;

function sbHeaders(extra) {
  return Object.assign({ apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" }, extra || {});
}
function authed(req) {
  const h = req.headers.authorization || "";
  return TOKEN && h === "Bearer " + TOKEN;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!SB || !SR) return res.status(200).json({ error: "not_configured" });

  try {
    if (req.method === "GET") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "missing_id" });
      const r = await fetch(`${SB}/rest/v1/dossiers?id=eq.${encodeURIComponent(id)}&select=data,title,updated_at`, { headers: sbHeaders() });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: "not_found" });
      return res.status(200).json({ id, data: rows[0].data, title: rows[0].title });
    }

    if (req.method === "POST") {
      if (!authed(req)) return res.status(401).json({ error: "unauthorized" });
      const { id, client_id, title, data } = req.body || {};
      if (!data) return res.status(400).json({ error: "missing_data" });

      if (id) {
        const r = await fetch(`${SB}/rest/v1/dossiers?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({ client_id: client_id || null, title: title || "", data, updated_at: new Date().toISOString() }),
        });
        if (!r.ok) return res.status(200).json({ error: "update_failed", detail: (await r.text()).slice(0, 300) });
        return res.status(200).json({ id, updated: true });
      }

      const newId = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
      const r = await fetch(`${SB}/rest/v1/dossiers`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ id: newId, client_id: client_id || null, title: title || "", data }),
      });
      if (!r.ok) return res.status(200).json({ error: "insert_failed", detail: (await r.text()).slice(0, 300) });
      return res.status(200).json({ id: newId, created: true });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(200).json({ error: "failed", message: String(e) });
  }
}
