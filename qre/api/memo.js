// Vercel serverless function — POST /api/memo
// Drafts a property memorandum (points forts / vigilance / avis prix) in the
// advisor's first-person voice, grounded in the supplied facts.
//
// Requires in Vercel → Settings → Environment Variables:
//   ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ error: "no_key", hint: "no_key" });

  try {
    const { property = {}, criteria = {}, lang = "fr" } = req.body || {};
    const p = property;

    const facts = [
      p.title && `Titre : ${p.title}`,
      p.location && `Localisation : ${p.location}`,
      p.price && `Prix affiché : ${p.price}`,
      p.surface && `Surface : ${p.surface}`,
      p.rooms && `Pièces : ${p.rooms}`,
      p.bedrooms && `Chambres : ${p.bedrooms}`,
      p.highlight && `Point saillant : ${p.highlight}`,
      p.description && `Descriptif : ${p.description}`,
    ].filter(Boolean).join("\n");

    const crit = [
      criteria.budget && `budget max ${criteria.budget}`,
      criteria.surfaceMin && `surface min ${criteria.surfaceMin} m²`,
      criteria.piecesMin && `pièces min ${criteria.piecesMin}`,
      criteria.chambresMin && `chambres min ${criteria.chambresMin}`,
      criteria.secteurs && `secteurs : ${criteria.secteurs}`,
      criteria.must && `indispensables : ${criteria.must}`,
    ].filter(Boolean).join(", ");

    const system = lang === "en"
      ? `You are a discreet, experienced Paris real-estate advisor writing a short private memorandum to a buyer client, in the first person ("I"). Tone: refined, candid, professional, never salesy. Ground every statement strictly in the facts provided — never invent surfaces, features, comparables or figures that are not given. For the price view, give a measured, preliminary professional opinion (market coherence, likely negotiation latitude) and explicitly frame it as a first read, not a formal valuation. Each section: 2 to 4 sentences. Reply with ONLY a JSON object, no markdown, no preamble: {"pros": "...", "cons": "...", "priceNote": "..."}`
      : `Vous êtes un conseiller immobilier parisien expérimenté et discret. Vous rédigez un court mémorandum privé destiné à un acquéreur, à la première personne (« je »). Ton : raffiné, franc, professionnel, jamais commercial ; registre soigné. Appuyez chaque remarque strictement sur les éléments fournis — n'inventez jamais de surfaces, prestations, références ou chiffres non communiqués. Pour l'avis sur le prix, donnez une opinion professionnelle mesurée et préliminaire (cohérence avec le marché, marge de négociation probable), clairement présentée comme une première lecture et non une estimation formelle. Chaque section : 2 à 4 phrases. Répondez UNIQUEMENT par un objet JSON, sans markdown ni préambule : {"pros": "...", "cons": "...", "priceNote": "..."}`;

    const user = (lang === "en"
      ? `Property facts:\n${facts || "(little detail provided)"}\n\nBuyer criteria: ${crit || "(none stated)"}\n\nWrite: pros (what genuinely works), cons (points to watch), priceNote (my view on the asking price).`
      : `Éléments du bien :\n${facts || "(peu d'éléments fournis)"}\n\nCritères de l'acquéreur : ${crit || "(non précisés)"}\n\nRédigez : pros (les points forts réels), cons (les points de vigilance), priceNote (mon avis sur le prix affiché).`);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(200).json({ error: "anthropic_" + r.status, detail: t.slice(0, 300) });
    }
    const out = await r.json();
    const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) { return res.status(200).json({ error: "parse_failed", raw: text.slice(0, 500) }); }

    return res.status(200).json({
      pros: parsed.pros || "",
      cons: parsed.cons || "",
      priceNote: parsed.priceNote || "",
    });
  } catch (e) {
    return res.status(200).json({ error: "failed", message: String(e) });
  }
}
