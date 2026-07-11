/* =========================================================
   My PoolBoy IA — Netlify Function : diagnostic-ia
   Appelle l'API Claude côté serveur (la clé API reste secrète,
   jamais exposée au navigateur). Reçoit la dernière mesure et
   un court historique, renvoie un diagnostic structuré en JSON.
   ========================================================= */

const SYSTEM_PROMPT = `Tu es un expert en entretien de piscines résidentielles.
Contexte fixe : piscine Intex ronde d'environ 27 m³, filtre à sable, électrolyseur au sel Intex QS700 Plus, localisation Verneuil-l'Étang (France).

On te donne la dernière mesure de l'utilisateur et un court historique récent (format JSON).
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte, explication ou balise markdown avant ou après, au format EXACT suivant :

{"score": <entier 0-100, score de santé de l'eau>, "baignade": {"autorisee": <true|false>, "raison": "<phrase courte>"}, "conseils": [{"type": "ok"|"warn"|"alert", "texte": "<conseil court, concret et actionnable en français>"}]}

Règles :
- 1 à 4 conseils maximum, les plus prioritaires en premier.
- "type":"alert" pour un risque sanitaire ou un déséquilibre important, "warn" pour une vigilance à avoir, "ok" si tout va bien.
- Les conseils doivent tenir compte de l'évolution dans l'historique (tendance), pas seulement de la dernière valeur.
- Reste concret : quantités, actions, délais, plutôt que des généralités.
- N'ajoute aucun champ en dehors de ceux demandés.`;

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

  const mesure = payload.mesure || null;
  const historique = Array.isArray(payload.historique) ? payload.historique.slice(0, 5) : [];

  if (!mesure) {
    return { statusCode: 400, body: JSON.stringify({ error: "Aucune mesure fournie." }) };
  }

  const userContent =
    `Dernière mesure : ${JSON.stringify(mesure)}\n` +
    `Historique récent (du plus récent au plus ancien) : ${JSON.stringify(historique)}`;

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
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: "Erreur API Anthropic.", detail }) };
    }

    const data = await res.json();
    const raw = (data.content || []).map((b) => b.text || "").join("").trim();
    const nettoye = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let diagnostic;
    try {
      diagnostic = JSON.parse(nettoye);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Réponse IA non exploitable.", raw }) };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(diagnostic)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Erreur inconnue." }) };
  }
};
