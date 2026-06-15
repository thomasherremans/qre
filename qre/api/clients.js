// Vercel serverless function — /api/clients  (all calls require Bearer EDITOR_TOKEN)
//   GET  → list clients (id, name, criteria)
//   POST → upsert {id?, name, criteria} → returns the saved client
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDITOR_TOKEN

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
  if (!authed(req)) return res.status(401).json({ error: "unauthorized" });

  try {
    if (req.method === "GET") {
      const r = await fetch(`${SB}/rest/v1/clients?select=id,name,criteria&order=updated_at.desc`, { headers: sbHeaders() });
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) ? rows : []);
    }

    if (req.method === "POST") {
      const { id, name, criteria } = req.body || {};
      const payload = { name: name || "", criteria: criteria || {}, updated_at: new Date().toISOString() };

      if (id) {
        const r = await fetch(`${SB}/rest/v1/clients?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify(payload),
        });
        const rows = await r.json();
        if (!r.ok) return res.status(200).json({ error: "update_failed", detail: JSON.stringify(rows).slice(0, 300) });
        return res.status(200).json(rows[0] || { id });
      }

      const r = await fetch(`${SB}/rest/v1/clients`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(payload),
      });
      const rows = await r.json();
      if (!r.ok) return res.status(200).json({ error: "insert_failed", detail: JSON.stringify(rows).slice(0, 300) });
      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(200).json({ error: "failed", message: String(e) });
  }
}
