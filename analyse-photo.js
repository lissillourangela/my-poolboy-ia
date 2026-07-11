/* =========================================================
   My PoolBoy IA — Vercel Function : /api/analyse-photo
   Envoie une photo du testeur (bandelette ou kit à réactifs) à
   Claude (vision) et renvoie une estimation de pH / chlore.
   La clé API reste côté serveur, jamais exposée au navigateur.
   ========================================================= */

const SYSTEM_PROMPT = `Tu es un expert en lecture de testeurs de piscine (bandelettes colorimétriques ou kits à réactifs liquides type pastilles/gouttes).
On te fournit une photo d'un testeur après réaction. Estime, à partir des couleurs visibles :
- le pH (échelle typique 6.8 à 8.4)
- le taux de chlore libre en mg/L (échelle typique 0 à 10)

Si une valeur n'est pas lisible ou absente de la photo, mets null pour ce champ plutôt que d'inventer un chiffre.

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte, explication ou balise markdown avant ou après, au format EXACT suivant :
{"ph": <nombre|null>, "chlore": <nombre|null>, "confiance": "haute"|"moyenne"|"faible", "note": "<courte remarque en français : type de testeur détecté, limite de lecture, ou conseil>"}`;

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
