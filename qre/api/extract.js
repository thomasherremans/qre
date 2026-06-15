// Vercel serverless function — /api/extract?url=<listing url>
// Optimised for the originating realtor/agency page (the unprotected source that
// SeLoger aggregates from). Direct fetch handles these with no scraping key.
//
// Optional anti-bot fallback for protected portals — set ONE in Vercel env vars:
//   SCRAPINGBEE_API_KEY   or   SCRAPERAPI_KEY
// Leave both unset to run purely on the free direct fetch.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Provide a valid ?url=" });
  }

  try {
    const got = await getHtml(url);
    if (!got.html) {
      return res.status(200).json({
        error: "blocked",
        status: got.status || 403,
        via: got.via,
        hint: hasKey() ? "scraper_failed" : "no_scraper_key",
      });
    }
    const data = parse(got.html, url);
    data.via = got.via;
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json({ error: "fetch_failed", message: String(e) });
  }
}

function hasKey() {
  return !!(process.env.SCRAPINGBEE_API_KEY || process.env.SCRAPERAPI_KEY);
}

// ---- fetch strategy: direct, then optional scraping API ----
async function getHtml(url) {
  let directStatus;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });
    directStatus = r.status;
    if (r.ok) {
      const html = await r.text();
      if (!looksBlocked(html)) return { html, via: "direct" };
    }
  } catch (e) {}

  const bee = process.env.SCRAPINGBEE_API_KEY;
  if (bee) {
    const api =
      "https://app.scrapingbee.com/api/v1/?api_key=" + bee +
      "&url=" + encodeURIComponent(url) +
      "&render_js=true&stealth_proxy=true&country_code=fr&block_resources=false";
    const r = await fetch(api);
    if (r.ok) { const html = await r.text(); if (!looksBlocked(html)) return { html, via: "scrapingbee" }; }
    return { html: null, status: r.status, via: "scrapingbee" };
  }
  const sa = process.env.SCRAPERAPI_KEY;
  if (sa) {
    const api =
      "https://api.scraperapi.com/?api_key=" + sa +
      "&url=" + encodeURIComponent(url) +
      "&render=true&ultra_premium=true&country_code=fr";
    const r = await fetch(api);
    if (r.ok) { const html = await r.text(); if (!looksBlocked(html)) return { html, via: "scraperapi" }; }
    return { html: null, status: r.status, via: "scraperapi" };
  }
  return { html: null, status: directStatus || 403, via: "direct" };
}

function looksBlocked(html) {
  if (!html || html.length < 600) return true;
  return /datadome|captcha-delivery|geo\.captcha|cf-browser-verification|Just a moment\.\.\.|Access (?:to this page has been )?denied|Pardon Our Interruption/i.test(html);
}

// ---- parser ----
function parse(html, url) {
  const meta = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"));
    return m ? decode(m[1]) : "";
  };
  const metaAll = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "gi");
    const out = []; let m; while ((m = re.exec(html))) out.push(decode(m[1])); return out;
  };

  let ld = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lm; while ((lm = ldRe.exec(html))) { try { const p = JSON.parse(lm[1].trim()); Array.isArray(p) ? ld.push(...p) : ld.push(p); } catch (e) {} }
  const ldFind = (key) => {
    for (const o of ld) { if (o && o[key] != null) return o[key]; if (o && o["@graph"]) for (const g of o["@graph"]) if (g && g[key] != null) return g[key]; }
    return null;
  };

  const title = meta("og:title") || meta("twitter:title") || (html.match(/<title>([^<]+)<\/title>/i)?.[1] || "").trim();
  const description = meta("og:description") || meta("description") || "";

  let price = meta("product:price:amount") || meta("og:price:amount") || "";
  const offer = ldFind("offers");
  if (!price && offer) { const p = Array.isArray(offer) ? offer[0] : offer; if (p && p.price) price = String(p.price); }
  if (price && /^\d+$/.test(price)) price = Number(price).toLocaleString("fr-FR") + " €";
  if (!price) { const pm = html.match(/([0-9][0-9\s.\u202f]{4,12})\s*€/); if (pm) price = pm[1].replace(/\s+/g, " ").trim() + " €"; }

  const text = html.replace(/<[^>]+>/g, " ");
  const surface = (text.match(/(\d{2,4})\s?m²/) || [])[1];
  const rooms = (text.match(/(\d{1,2})\s?pi[èe]ces?/i) || [])[1];

  // location: JSON-LD address first, then a Paris arrondissement hint
  let location = "";
  const addr = ldFind("address");
  if (addr) {
    if (typeof addr === "string") location = decode(addr);
    else location = [addr.addressLocality, addr.postalCode].filter(Boolean).join(" ");
  }
  if (!location) {
    const pm = text.match(/Paris\s+(\d{1,2})\s?(?:er|e|ème|e arrondissement)/i);
    if (pm) location = "Paris " + pm[1] + (pm[1] === "1" ? "er" : "e");
  }

  // ---- images: og + jsonld + lazy-load attrs + srcset + body fallback ----
  const imgs = new Set();
  const junk = (u) => /(logo|sprite|icon|favicon|placeholder|avatar|pixel|blank|thumb|vignette|\bmini\b|\/xs\/|\/min\/|spacer|-\d{2,3}x\d{2,3}\.)/i.test(u);
  const add = (u) => { if (!u) return; u = decode(String(u).trim()); if (!/^https?:\/\//.test(u)) return; if (junk(u)) return; imgs.add(u); };

  metaAll("og:image").forEach(add);
  metaAll("og:image:secure_url").forEach(add);
  metaAll("twitter:image").forEach(add);
  const ldImg = ldFind("image");
  if (ldImg) (Array.isArray(ldImg) ? ldImg : [ldImg]).forEach((u) => add(typeof u === "string" ? u : (u && u.url)));

  let am; const attrRe = /(?:src|data-src|data-lazy|data-lazy-src|data-original)=["']([^"']+?\.(?:jpe?g|webp)(?:\?[^"']*)?)["']/gi;
  while ((am = attrRe.exec(html)) && imgs.size < 40) add(am[1]);

  let sm; const ssRe = /srcset=["']([^"']+)["']/gi;
  while ((sm = ssRe.exec(html)) && imgs.size < 40) sm[1].split(",").forEach((c) => add(c.trim().split(/\s+/)[0]));

  let cm; const cdnRe = /https?:\/\/[^"'\s)]+\.(?:jpe?g|webp)(?:\?[^"'\s)]*)?/gi;
  while ((cm = cdnRe.exec(html)) && imgs.size < 40) add(cm[0]);

  return {
    title, price,
    description: description.slice(0, 1200),
    surface: surface ? surface + " m²" : "",
    rooms: rooms ? rooms + " pièces" : "",
    location,
    images: [...imgs].slice(0, 12),
    source: url,
  };
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è");
}
