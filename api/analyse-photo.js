/* =========================================================
   My PoolBoy IA — Vercel Function : /api/analyse-photo
   Envoie une photo du testeur (bandelette ou kit à réactifs) à
   Claude (vision) et renvoie une estimation de pH / chlore.
   La clé API reste côté serveur, jamais exposée au navigateur.
   ========================================================= */

const SYSTEM_PROMPT = `Tu es un expert en lecture d'instruments et en observation visuelle de piscines. La photo peut montrer :
(a) le manomètre (cadran à aiguille) du filtre à sable, indiquant une pression en bar, et/ou
(b) l'aspect général de l'eau du bassin (couleur, transparence).

Pour le manomètre : lis la valeur indiquée par la position de l'aiguille sur le cadran, en bar (échelle typique 0 à 3 bar).
Pour l'aspect de l'eau : classe-le dans une seule de ces catégories : "limpide" (eau claire et transparente), "trouble" (légèrement voilée), "verte" (teinte verte, présence probable d'algues), "laiteuse" (blanchâtre, opaque).

Si le manomètre ou le bassin n'est pas visible sur la photo, mets null pour le champ correspondant plutôt que d'inventer une valeur.

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte, explication ou balise markdown avant ou après, au format EXACT suivant :
{"pression": <nombre|null>, "aspect": "limpide"|"trouble"|"verte"|"laiteuse"|null, "confiance": "haute"|"moyenne"|"faible", "note": "<courte remarque en français : ce qui a été détecté sur la photo, ou limite de lecture>"}`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Clé API non configurée côté serveur (ANTHROPIC_API_KEY manquante)." });
    return;
  }

  const body = req.body || {};
  const { image, mediaType } = body;
  if (!image || !mediaType) {
    res.status(400).json({ error: "Photo manquante." });
    return;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    res.status(400).json({ error: "Format d'image non pris en charge." });
    return;
  }
  if (image.length > 4 * 1024 * 1024) {
    res.status(413).json({ error: "Photo trop volumineuse." });
    return;
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Analyse cette photo de testeur de piscine et renvoie le JSON demandé." }
          ]
        }]
      })
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      res.status(apiRes.status).json({ error: "Erreur API Anthropic.", detail });
      return;
    }

    const data = await apiRes.json();
    const raw = (data.content || []).map((b) => b.text || "").join("").trim();
    const nettoye = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let resultat;
    try {
      resultat = JSON.parse(nettoye);
    } catch (e) {
      res.status(502).json({ error: "Réponse IA non exploitable.", raw });
      return;
    }

    res.status(200).json(resultat);
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur inconnue." });
  }
};
