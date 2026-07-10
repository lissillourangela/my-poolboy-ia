/* =========================================================
   My PoolBoy IA — Netlify Function : analyse-photo
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

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Méthode non autorisée." }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé API non configurée côté serveur (ANTHROPIC_API_KEY manquante)." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Corps de requête invalide." }) };
  }

  const { image, mediaType } = payload;
  if (!image || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Photo manquante." }) };
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Format d'image non pris en charge." }) };
  }
  // Sécurité basique : la requête base64 ne doit pas dépasser ~6 Mo (limite Netlify Functions)
  if (image.length > 6 * 1024 * 1024) {
    return { statusCode: 413, body: JSON.stringify({ error: "Photo trop volumineuse." }) };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
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

    if (!res.ok) {
      const detail = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: "Erreur API Anthropic.", detail }) };
    }

    const data = await res.json();
    const raw = (data.content || []).map((b) => b.text || "").join("").trim();

    let resultat;
    try {
      resultat = JSON.parse(raw);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Réponse IA non exploitable.", raw }) };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resultat)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Erreur inconnue." }) };
  }
};
