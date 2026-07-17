/* =========================================================
   My PoolBoy IA — Vercel Function : /api/diagnostic-ia
   Appelle l'API Claude côté serveur (la clé API reste secrète,
   jamais exposée au navigateur). Reçoit la dernière mesure et
   un court historique, renvoie un diagnostic structuré en JSON.
   ========================================================= */

const SYSTEM_PROMPT = `Tu es un expert en entretien de piscines résidentielles.
Contexte fixe : piscine Intex ronde d'environ 27 m³, filtre à sable, électrolyseur au sel Intex QS700 Plus, localisation Verneuil-l'Étang (France).

On te donne la dernière mesure de l'utilisateur et un court historique récent (format JSON). La mesure peut inclure : ph, chlore (libre), chloreTotal, tac (alcalinité), stabilisant (acide cyanurique), temperature, pression, aspect, contexte. Certains champs peuvent être absents (null) si l'utilisateur n'a pas de testeur les mesurant.

Utilise ces plages de référence pour calibrer la sévérité de tes conseils (ne les invente pas différemment) :
- pH : cible 7.2–7.6, plage large acceptable 6.8–8.0
- Chlore libre : cible 1–3 mg/L, plage large acceptable 0.3–5 mg/L
- Chlore combiné (chlore total moins chlore libre) : idéalement < 0.5 mg/L
- TAC : cible 80–120 mg/L, plage large acceptable 60–150 mg/L
- Stabilisant : cible 30–50 mg/L, plage large acceptable 20–100 mg/L (au-delà de 100, le chlore devient inefficace)

Ne mets "baignade autorisée" à false que si un paramètre sort de sa PLAGE LARGE (pas juste de sa cible idéale), ou si l'aspect de l'eau est vert/laiteux. Rester hors de la cible idéale mais dans la plage large justifie un conseil "warn", pas une interdiction de baignade.

Ne donne JAMAIS de quantité précise en grammes ou kilogrammes pour un produit (pH-, chlore choc, sel, floculant) : la dose exacte dépend de la concentration du produit utilisé, que tu ne connais pas, et une estimation inventée peut être dangereusement fausse. Indique seulement la direction de l'ajustement (ex. "réduis légèrement le pH avec du pH-") et renvoie l'utilisateur vers les calculateurs de l'application (onglet Plus) pour la dose chiffrée.

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte, explication ou balise markdown avant ou après, au format EXACT suivant :

{"score": <entier 0-100, score de santé de l'eau>, "baignade": {"autorisee": <true|false>, "raison": "<phrase courte>"}, "conseils": [{"type": "ok"|"warn"|"alert", "texte": "<conseil court, concret et actionnable en français>"}]}

Règles :
- 1 à 4 conseils maximum, les plus prioritaires en premier.
- "type":"alert" pour un risque sanitaire ou un déséquilibre important, "warn" pour une vigilance à avoir, "ok" si tout va bien.
- Intègre des conseils pratiques de timing quand c'est pertinent : traitement choc de préférence le soir ou par temps couvert (les UV dégradent le chlore non stabilisé), débâchage en journée par forte chaleur si la piscine est couverte (une eau chaude et confinée favorise algues et bactéries).
- Les conseils doivent tenir compte de l'évolution dans l'historique (tendance), pas seulement de la dernière valeur.
- Reste concret : quantités, actions, délais, plutôt que des généralités.
- N'ajoute aucun champ en dehors de ceux demandés.`;

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
  const mesure = body.mesure || null;
  const historique = Array.isArray(body.historique) ? body.historique.slice(0, 5) : [];

  if (!mesure) {
    res.status(400).json({ error: "Aucune mesure fournie." });
    return;
  }

  const userContent =
    `Dernière mesure : ${JSON.stringify(mesure)}\n` +
    `Historique récent (du plus récent au plus ancien) : ${JSON.stringify(historique)}`;

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
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }]
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

    let diagnostic;
    try {
      diagnostic = JSON.parse(nettoye);
    } catch (e) {
      res.status(502).json({ error: "Réponse IA non exploitable.", raw });
      return;
    }

    res.status(200).json(diagnostic);
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur inconnue." });
  }
};
