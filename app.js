/* =========================================================
   MY POOLBOY IA — V3 — app.js
   Vanilla JS, sans dépendance. Architecture en modules simples
   (namespace unique PoolBoy) pour rester lisible et évolutive.
   ========================================================= */

const PoolBoy = (() => {
  "use strict";

  /* =======================================================
     1. CONFIGURATION & CIBLES
     ======================================================= */
  const TARGETS = {
    ph:     { min: 7.2, max: 7.6, warnMin: 6.8, warnMax: 8.0 },
    chlore: { min: 1,   max: 3,   warnMin: 0.3, warnMax: 5   },
    sel:    { min: 3000, max: 5000, warnMin: 2500, warnMax: 6000 }
  };

  const STORAGE_KEYS = {
    settings: "poolboy_settings_v3",
    mesures:  "poolboy_mesures_v3",
    carnet:   "poolboy_carnet_v3"
  };

  const DEFAULT_SETTINGS = { nom: "Ma piscine", volume: 27, diametre: 5.49, hauteur: 1.32, lat: 48.6444, lon: 2.8328 };

  /* =======================================================
     2. POINTS D'EXTENSION (hors V3, architecture anticipée)
     Ces objets sont volontairement vides / no-op en V3.
     Un futur module peut les remplacer sans toucher au reste du code :
       PoolBoy.hooks.photoAnalysis(imageBlob)   -> analyse photo test colorimétrique
       PoolBoy.hooks.weather(location)          -> météo locale
       PoolBoy.hooks.notifications.schedule(x)  -> notifications locales/push
       PoolBoy.hooks.cloudSync.push/pull()      -> synchronisation cloud
       PoolBoy.hooks.aiAssistant(mesure, histo) -> IA connectée (remplace diagnostiquerRegles)
       PoolBoy.hooks.multiPool                  -> gestion de plusieurs bassins
     ======================================================= */
  const hooks = {
    photoAnalysis: null,
    weather: null,
    notifications: null,
    cloudSync: null,
    aiAssistant: null,
    multiPool: null
  };

  /* =======================================================
     3. STOCKAGE (localStorage, isolé pour rester remplaçable)
     ======================================================= */
  const Store = {
    read(cle, defaut) {
      try {
        const v = localStorage.getItem(cle);
        return v ? JSON.parse(v) : defaut;
      } catch (e) { return defaut; }
    },
    write(cle, valeur) {
      try { localStorage.setItem(cle, JSON.stringify(valeur)); }
      catch (e) { UI.toast("Stockage indisponible sur cet appareil."); }
    },
    getSettings() { return Object.assign({}, DEFAULT_SETTINGS, this.read(STORAGE_KEYS.settings, {})); },
    setSettings(s) { this.write(STORAGE_KEYS.settings, s); },
    getMesures() { return this.read(STORAGE_KEYS.mesures, []); },
    addMesure(m) {
      const liste = this.getMesures();
      liste.unshift(Object.assign({ id: Date.now(), date: new Date().toISOString() }, m));
      this.write(STORAGE_KEYS.mesures, liste);
    },
    lastMesure() { const l = this.getMesures(); return l.length ? l[0] : null; },
    clearMesures() { this.write(STORAGE_KEYS.mesures, []); },
    getCarnet() { return this.read(STORAGE_KEYS.carnet, []); },
    addCarnet(e) {
      const liste = this.getCarnet();
      liste.unshift(Object.assign({ id: Date.now(), date: new Date().toISOString() }, e));
      this.write(STORAGE_KEYS.carnet, liste);
    }
  };

  /* =======================================================
     4. CALCULS CHIMIE / VOLUME
     ======================================================= */
  const Calc = {
    volumeGeometrique(diametre, hauteur) {
      const r = diametre / 2;
      return Math.PI * r * r * hauteur;
    },
    volumeActif() { return Store.getSettings().volume; },
    phMoins(actuel, cible) {
      const ecart = actuel - cible;
      if (ecart <= 0) return null;
      // Estimation générique indicative : ~150 g de pH- granulaire / m³ / point de pH
      return Math.round(this.volumeActif() * ecart * 150);
    },
    chloreChoc() {
      // Base indicative : 20 g / m³ pour un traitement choc non stabilisé
      return Math.round(this.volumeActif() * 20);
    },
    sel(actuel, cible) {
      const ecart = cible - actuel;
      if (ecart <= 0) return null;
      return (this.volumeActif() * ecart) / 1000; // kg
    },
    dureeFiltration(temp) {
      const t = parseFloat(temp);
      if (isNaN(t)) return null;
      return Math.max(8, Math.round(t / 2));
    },
    floculant() {
      const v = this.volumeActif();
      const pastilles = Math.max(1, Math.round(v / 50));
      const dosesLiquide = Math.max(1, Math.round(v / 10));
      return { pastilles, dosesLiquide };
    }
  };

  /* =======================================================
     5. DIAGNOSTIC — score santé, baignade, conseils
     Cette fonction fait office d'assistant local par défaut.
     Elle est remplacée par hooks.aiAssistant si celui-ci est défini.
     ======================================================= */
  const Diagnostic = {
    analyser(m) {
      if (hooks.aiAssistant) return hooks.aiAssistant(m, Store.getMesures());
      return this._reglesLocales(m);
    },

    _reglesLocales(m) {
      const conseils = [];
      let score = 100;
      let baignade = { autorisee: true, raison: "Les paramètres sont dans les plages recommandées." };

      const has = (v) => v !== null && v !== undefined && v !== "";

      if (has(m.ph)) {
        const v = parseFloat(m.ph);
        if (v < TARGETS.ph.warnMin || v > TARGETS.ph.warnMax) {
          score -= 35;
          conseils.push({ type: "alert", texte: `pH à ${v} : hors plage de sécurité. Corrige avant toute baignade.` });
          baignade = { autorisee: false, raison: `pH à ${v}, hors plage de sécurité (6.8–8.0).` };
        } else if (v < TARGETS.ph.min || v > TARGETS.ph.max) {
          score -= 12;
          conseils.push({ type: "warn", texte: `pH à ${v}, légèrement hors cible (7.2–7.6). Ajuste avec pH- ou pH+.` });
        }
      }

      if (has(m.chlore)) {
        const v = parseFloat(m.chlore);
        if (v < TARGETS.chlore.warnMin) {
          score -= 30;
          conseils.push({ type: "alert", texte: `Chlore à ${v} mg/L : eau non désinfectée, risque sanitaire.` });
          baignade = { autorisee: false, raison: `Chlore trop faible (${v} mg/L).` };
        } else if (v > TARGETS.chlore.warnMax) {
          score -= 20;
          conseils.push({ type: "alert", texte: `Chlore à ${v} mg/L : trop élevé, attends que le taux redescende sous 3 mg/L.` });
          baignade = { autorisee: false, raison: `Chlore trop élevé (${v} mg/L), irritant pour la peau et les yeux.` };
        } else if (v < TARGETS.chlore.min || v > TARGETS.chlore.max) {
          score -= 10;
          conseils.push({ type: "warn", texte: `Chlore à ${v} mg/L, hors cible (1–3 mg/L).` });
        }
      }

      if (has(m.sel)) {
        const v = parseFloat(m.sel);
        if (v < TARGETS.sel.warnMin) {
          score -= 15;
          conseils.push({ type: "warn", texte: `Sel à ${v} mg/L : l'électrolyseur QS700 produit moins de chlore. Ajoute du sel.` });
        } else if (v > TARGETS.sel.warnMax) {
          score -= 8;
          conseils.push({ type: "warn", texte: `Sel à ${v} mg/L, au-dessus de la plage recommandée.` });
        }
      }

      if (has(m.pression) && parseFloat(m.pression) >= 1) {
        score -= 10;
        conseils.push({ type: "warn", texte: `Pression filtre à ${m.pression} bar : fais un contre-lavage.` });
      }

      if (m.aspect && m.aspect !== "limpide") {
        const libelle = { trouble: "légèrement trouble", verte: "verdâtre", laiteuse: "laiteuse" }[m.aspect] || m.aspect;
        if (m.aspect === "verte") {
          score -= 30;
          conseils.push({ type: "alert", texte: "Eau verte : présence probable d'algues. Traitement choc + brossage + filtration continue nécessaires." });
          baignade = { autorisee: false, raison: "Eau verte : baignade déconseillée jusqu'au traitement." };
        } else if (m.aspect === "laiteuse") {
          score -= 20;
          conseils.push({ type: "alert", texte: "Eau laiteuse : vérifie le pH et envisage un floculant." });
        } else {
          score -= 10;
          conseils.push({ type: "warn", texte: `Eau ${libelle} : augmente la durée de filtration.` });
        }
      }

      if (m.contexte && m.contexte.length) {
        if (m.contexte.includes("canicule")) conseils.push({ type: "warn", texte: "Canicule : le chlore se consomme plus vite, contrôle et filtre plus longtemps." });
        if (m.contexte.includes("orage")) conseils.push({ type: "warn", texte: "Orage récent : recontrôle le pH et le chlore, la pluie les fait varier." });
        if (m.contexte.includes("forte_baignade")) conseils.push({ type: "warn", texte: "Forte fréquentation : le chlore se consomme plus vite, surveille dans les heures qui suivent." });
      }

      score = Math.max(0, Math.min(100, score));
      if (!conseils.length) conseils.push({ type: "ok", texte: "Tous les paramètres renseignés sont dans les plages recommandées." });

      return { score, baignade, conseils };
    }
  };

  /* =======================================================
     6ter. MÉTÉO — Open-Meteo (API publique, sans clé)
     Échoue silencieusement hors connexion : la carte reste masquée.
     ======================================================= */
  const Weather = {
    lastFetch: 0,
    cache: null,

    CODES: {
      0: { label: "Ciel dégagé", icon: "☀️" }, 1: { label: "Peu nuageux", icon: "🌤️" },
      2: { label: "Partiellement nuageux", icon: "⛅" }, 3: { label: "Couvert", icon: "☁️" },
      45: { label: "Brouillard", icon: "🌫️" }, 48: { label: "Brouillard givrant", icon: "🌫️" },
      51: { label: "Bruine légère", icon: "🌦️" }, 53: { label: "Bruine", icon: "🌦️" }, 55: { label: "Bruine forte", icon: "🌦️" },
      61: { label: "Pluie légère", icon: "🌧️" }, 63: { label: "Pluie", icon: "🌧️" }, 65: { label: "Pluie forte", icon: "🌧️" },
      71: { label: "Neige légère", icon: "🌨️" }, 73: { label: "Neige", icon: "🌨️" }, 75: { label: "Neige forte", icon: "🌨️" },
      80: { label: "Averses", icon: "🌦️" }, 81: { label: "Averses fortes", icon: "🌦️" }, 82: { label: "Averses violentes", icon: "⛈️" },
      95: { label: "Orage", icon: "⛈️" }, 96: { label: "Orage avec grêle", icon: "⛈️" }, 99: { label: "Orage violent", icon: "⛈️" }
    },

    async fetch() {
      const now = Date.now();
      if (this.cache && (now - this.lastFetch) < 20 * 60 * 1000) return this.cache; // cache 20 min
      const s = Store.getSettings();
      const lat = s.lat ?? DEFAULT_SETTINGS.lat, lon = s.lon ?? DEFAULT_SETTINGS.lon;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FParis`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("réponse invalide");
        const data = await res.json();
        this.cache = data;
        this.lastFetch = now;
        return data;
      } catch (e) {
        return null;
      }
    },

    async render() {
      const card = document.getElementById("weather-card");
      const data = await this.fetch();
      if (!data || !data.current) { card.hidden = true; return; }

      const temp = Math.round(data.current.temperature_2m);
      const meta = this.CODES[data.current.weather_code] || { label: "—", icon: "🌡️" };
      const tMax = data.daily && data.daily.temperature_2m_max ? Math.round(data.daily.temperature_2m_max[0]) : null;
      const pluie = data.daily && data.daily.precipitation_sum ? data.daily.precipitation_sum[0] : 0;

      document.getElementById("weather-icon").textContent = meta.icon;
      document.getElementById("weather-temp").textContent = `${temp}°C`;
      document.getElementById("weather-desc").textContent = meta.label + (tMax !== null ? ` · max ${tMax}°C` : "");

      const hint = document.getElementById("weather-hint");
      if (tMax !== null && tMax >= 30) {
        hint.textContent = "Forte chaleur aujourd'hui : le chlore se consomme plus vite, pense à vérifier ton taux en fin de journée.";
      } else if (pluie && pluie >= 5) {
        hint.textContent = "Pluie annoncée : recontrôle le pH et le chlore après l'épisode pluvieux.";
      } else {
        hint.textContent = "";
      }
      card.hidden = false;
    }
  };

  /* =======================================================
     6bis. GRAPHIQUES — tendances pH / chlore (Chart.js via CDN)
     Si Chart.js n'est pas chargé (ex. hors-ligne, première visite),
     la section affiche simplement le message vide sans planter l'app.
     ======================================================= */
  const Charts = {
    instance: null,
    render() {
      const canvas = document.getElementById("chart-tendances");
      const emptyNote = document.getElementById("chart-empty");
      if (!canvas) return;

      const mesures = Store.getMesures().slice(0, 15).reverse(); // chronologique, 15 derniers relevés
      const exploitables = mesures.filter(m => m.ph != null || m.chlore != null);

      if (exploitables.length < 2 || typeof Chart === "undefined") {
        canvas.hidden = true;
        emptyNote.hidden = false;
        if (this.instance) { this.instance.destroy(); this.instance = null; }
        return;
      }
      canvas.hidden = false;
      emptyNote.hidden = true;

      const labels = exploitables.map(m => new Date(m.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }));
      const phData = exploitables.map(m => m.ph != null ? parseFloat(m.ph) : null);
      const chloreData = exploitables.map(m => m.chlore != null ? parseFloat(m.chlore) : null);

      if (this.instance) this.instance.destroy();
      this.instance = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "pH", data: phData, borderColor: "#007AFF", backgroundColor: "transparent", tension: .3, spanGaps: true, yAxisID: "yPh", pointRadius: 3 },
            { label: "Chlore (mg/L)", data: chloreData, borderColor: "#FF9500", backgroundColor: "transparent", tension: .3, spanGaps: true, yAxisID: "yChlore", pointRadius: 3 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
          scales: {
            yPh: { position: "left", suggestedMin: 6.8, suggestedMax: 8.2, ticks: { font: { size: 10 } } },
            yChlore: { position: "right", suggestedMin: 0, suggestedMax: 6, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
            x: { ticks: { font: { size: 10 } } }
          }
        }
      });
    }
  };

  /* =======================================================
     7. BASE DE CONNAISSANCE — assistant (problèmes courants)
     ======================================================= */
  const TOPICS = [
    { id: "eau_trouble", titre: "Eau trouble", reponse: "Vérifie le pH (7.2–7.6) et le chlore (1–3 mg/L). Nettoie le filtre si la pression est élevée. Filtre en continu 24h et envisage un floculant si l'eau reste trouble après 24h." },
    { id: "eau_verte", titre: "Eau verte", reponse: "Signe d'algues. 1) Brosse les parois. 2) Fais un traitement choc au chlore. 3) Filtre en continu jusqu'à retour de la limpidité. 4) Contrôle le pH avant et après le traitement. Pas de baignade tant que l'eau reste verte." },
    { id: "baisse_debit", titre: "Baisse de débit à la pompe", reponse: "Vérifie le panier du préfiltre (débris), le niveau d'eau du bassin, et l'état du sable ou de la cartouche. Un contre-lavage peut suffire si la pression est haute." },
    { id: "pression_filtre", titre: "Pression filtre élevée", reponse: "Si la pression dépasse de 0.3 à 0.5 bar le repère \"propre\", fais un contre-lavage (position Backwash) suivi d'un rinçage (position Rinse), puis reviens en position Filtration." },
    { id: "electrolyseur", titre: "Électrolyseur ne produit pas", reponse: "Vérifie : 1) le taux de sel (3000–5000 mg/L pour le QS700 Plus), 2) la propreté de la cellule (dépôts calcaires à nettoyer), 3) la température de l'eau (production réduite sous 15°C), 4) que la filtration est bien active." },
    { id: "sel", titre: "Ajuster le taux de sel", reponse: "Mesure le taux de sel avec un testeur ou les bandelettes compatibles. Utilise le calculateur de sel (onglet Plus) pour connaître la quantité à ajouter, verse progressivement le long des parois, filtration en marche." },
    { id: "contre_lavage", titre: "Faire un contre-lavage", reponse: "1) Arrête la pompe. 2) Mets la vanne en position Backwash. 3) Relance la pompe jusqu'à ce que l'eau ressorte claire (1–2 min). 4) Arrête, repasse en position Rinse, relance 20-30 secondes. 5) Repasse en position Filtration." },
    { id: "filtration", titre: "Régler la durée de filtration", reponse: "Règle simple : température de l'eau ÷ 2 = nombre d'heures de filtration par jour (minimum 8h). Utilise le calculateur dans l'onglet Plus, et augmente en cas de canicule ou forte fréquentation." },
    { id: "baignade", titre: "Puis-je me baigner ?", reponse: "Vérifie le bandeau \"baignade\" de l'accueil : il se base sur ton dernier relevé (pH, chlore, aspect de l'eau). En cas de doute, refais une analyse avant de te baigner." },
    { id: "hivernage", titre: "Hivernage", reponse: "Avant l'arrêt : équilibre le pH, fais un traitement choc, nettoie le filtre à fond. Baisse le niveau d'eau si nécessaire, protège la pompe du gel, et couvre le bassin. Voir la fiche guide dédiée dans l'onglet Plus." }
  ];

  /* =======================================================
     7. GUIDES (fiches pratiques)
     ======================================================= */
  const GUIDES = [
    { id: "install_qs700", titre: "Installation QS700 Plus", contenu: "<ol><li>Coupe l'alimentation de la pompe avant toute manipulation.</li><li>Installe la cellule sur le circuit de retour, après le filtre à sable.</li><li>Respecte le sens du flux d'eau indiqué sur le boîtier.</li><li>Raccorde le boîtier de commande à l'abri de l'humidité et des projections directes.</li><li>Amène le taux de sel entre 3000 et 5000 mg/L avant la première mise en route.</li><li>Démarre la filtration avant d'activer l'électrolyse, jamais l'inverse.</li></ol>" },
    { id: "guide_contre_lavage", titre: "Contre-lavage", contenu: "<ol><li>Arrête la pompe.</li><li>Positionne la vanne multivoies sur Backwash.</li><li>Relance la pompe 1 à 2 minutes, jusqu'à ce que l'eau visible dans le regard soit claire.</li><li>Arrête la pompe.</li></ol>" },
    { id: "guide_rincage", titre: "Rinçage", contenu: "<ol><li>Après le contre-lavage, positionne la vanne sur Rinse.</li><li>Relance la pompe 20 à 30 secondes.</li><li>Arrête, puis repasse en position Filtration avant de relancer normalement.</li></ol><p>Cette étape évite de renvoyer les impuretés décollées dans le bassin.</p>" },
    { id: "guide_demarrage", titre: "Démarrage de saison", contenu: "<ol><li>Nettoie le bassin et les parois.</li><li>Vérifie et nettoie le filtre à sable (remplace le sable tous les 3 à 5 ans).</li><li>Remets la piscine à niveau.</li><li>Contrôle et ajuste le pH en premier (7.2–7.6).</li><li>Vérifie le taux de sel puis relance l'électrolyseur.</li><li>Fais un traitement choc de démarrage.</li><li>Filtre en continu 24 à 48h avant la première baignade.</li></ol>" },
    { id: "guide_vacances", titre: "Départ en vacances", contenu: "<ul><li>Augmente légèrement la durée de filtration avant le départ.</li><li>Vérifie pH, chlore et sel juste avant de partir.</li><li>Si possible, demande à un proche de vérifier l'aspect de l'eau une fois par semaine.</li><li>Pense à un traitement lent (galets) en complément si absence de plus d'une semaine.</li></ul>" },
    { id: "guide_fermeture", titre: "Fermeture / hivernage", contenu: "<ol><li>Équilibre le pH (7.2–7.6).</li><li>Fais un traitement choc.</li><li>Nettoie soigneusement le filtre (contre-lavage puis rinçage).</li><li>Baisse le niveau d'eau sous les buses si hivernage passif.</li><li>Débranche et protège la pompe et la cellule d'électrolyse du gel.</li><li>Couvre le bassin.</li></ol>" }
  ];

  /* =======================================================
     8. UI — rendu et interactions
     ======================================================= */
  const UI = {
    currentView: "accueil",
    contexteSelection: [],
    toastTimer: null,

    toast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.add("is-visible");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2400);
    },

    formatDate(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) + " · " +
             d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    },

    escape(str) {
      const d = document.createElement("div");
      d.textContent = str;
      return d.innerHTML;
    },

    TITLES: { accueil: "Accueil", analyses: "Analyses", assistant: "Assistant", carnet: "Carnet", plus: "Plus" },

    goTo(target) {
      this.currentView = target;
      document.querySelectorAll(".view").forEach(v => v.hidden = v.dataset.view !== target);
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("is-active", b.dataset.target === target));
      document.getElementById("navbar-title").textContent = this.TITLES[target] || "";
      if (target === "accueil") this.renderAccueil();
      if (target === "analyses") this.renderAnalyses();
      if (target === "assistant") this.renderAssistant();
      if (target === "carnet") this.renderCarnet();
      if (target === "plus") this.renderPlus();
      window.scrollTo(0, 0);
    },

    /* ---------- ACCUEIL ---------- */
    renderAccueil() {
      document.getElementById("dash-date").textContent =
        new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

      Weather.render();

      const m = Store.lastMesure();
      const scoreFill = document.getElementById("score-fill");
      const scoreValue = document.getElementById("score-value");
      const swimBanner = document.getElementById("swim-banner");
      const swimIcon = document.getElementById("swim-icon");
      const swimTitle = document.getElementById("swim-title");
      const swimDetail = document.getElementById("swim-detail");
      const conseilsList = document.getElementById("conseils-list");
      const lastReadings = document.getElementById("last-readings");
      const circumference = 2 * Math.PI * 60;

      swimBanner.classList.remove("ok", "warn", "alert");

      if (!m) {
        scoreFill.style.strokeDasharray = `0 ${circumference}`;
        scoreValue.textContent = "–";
        swimIcon.textContent = "–";
        swimTitle.textContent = "Aucune donnée";
        swimDetail.textContent = "Ajoute une analyse pour savoir si la baignade est recommandée.";
        conseilsList.innerHTML = `<p class="empty-note">Rien à signaler pour l'instant.</p>`;
        lastReadings.innerHTML = `<p class="empty-note">Aucun relevé enregistré.</p>`;
        document.getElementById("filt-hours").textContent = "—";
        document.getElementById("filt-note").textContent = "Renseigne la température pour calculer la durée.";
        return;
      }

      const diag = Diagnostic.analyser(m);
      const pct = diag.score / 100;
      scoreFill.style.strokeDasharray = `${circumference * pct} ${circumference}`;
      scoreFill.style.stroke = diag.score >= 75 ? "var(--green)" : diag.score >= 45 ? "var(--orange)" : "var(--red)";
      scoreValue.textContent = diag.score;

      if (diag.baignade.autorisee) {
        swimBanner.classList.add("ok"); swimIcon.textContent = "✓";
        swimTitle.textContent = "Baignade recommandée";
      } else {
        const isAlert = diag.score < 45;
        swimBanner.classList.add(isAlert ? "alert" : "warn");
        swimIcon.textContent = "!";
        swimTitle.textContent = "Baignade déconseillée";
      }
      swimDetail.textContent = diag.baignade.raison;

      conseilsList.innerHTML = diag.conseils.slice(0, 4).map(c => `
        <div class="advice-item ${c.type === "ok" ? "" : c.type}">
          <span class="advice-dot"></span>
          <p>${c.texte}</p>
        </div>`).join("");

      const readings = [
        { label: "pH", value: m.ph, cls: this._classFor("ph", m.ph) },
        { label: "Chlore mg/L", value: m.chlore, cls: this._classFor("chlore", m.chlore) },
        { label: "Température", value: m.temperature != null ? m.temperature + " °C" : null, cls: "" },
        { label: "Pression bar", value: m.pression, cls: parseFloat(m.pression) >= 1 ? "warn" : "" }
      ].filter(r => r.value !== null && r.value !== undefined && r.value !== "");
      lastReadings.innerHTML = readings.length ? readings.map(r => `
        <div class="reading">
          <p class="reading-label">${r.label}</p>
          <p class="reading-value ${r.cls}">${r.value}</p>
        </div>`).join("") : `<p class="empty-note">Aucun relevé enregistré.</p>`;

      const h = Calc.dureeFiltration(m.temperature);
      document.getElementById("filt-hours").textContent = h ?? "—";
      document.getElementById("filt-note").textContent = h
        ? `Basé sur ${m.temperature} °C — règle indicative température ÷ 2 (min. 8h).`
        : "Renseigne la température pour calculer la durée.";
    },

    _classFor(param, value) {
      if (value === null || value === undefined || value === "") return "";
      const v = parseFloat(value);
      const t = TARGETS[param];
      if (!t) return "";
      if (v < t.warnMin || v > t.warnMax) return "alert";
      if (v < t.min || v > t.max) return "warn";
      return "";
    },

    /* ---------- ANALYSES ---------- */
    renderAnalyses() {
      this.renderHistorique();
      Charts.render();
    },

    renderHistorique() {
      const liste = Store.getMesures();
      const el = document.getElementById("historique-list");
      if (!liste.length) { el.innerHTML = `<p class="empty-note">Aucune mesure enregistrée pour le moment.</p>`; return; }
      el.innerHTML = liste.map(m => {
        const diag = Diagnostic.analyser(m);
        const pire = diag.score < 45 ? "alert" : (diag.score < 75 ? "warn" : "");
        return `
        <div class="entry">
          <div class="entry-top">
            <span class="entry-title">pH ${m.ph ?? "–"} · Cl ${m.chlore ?? "–"} mg/L</span>
            <span class="entry-date">${this.formatDate(m.date)}</span>
          </div>
          <div class="entry-tags">
            ${m.temperature ? `<span class="tag">${m.temperature} °C</span>` : ""}
            ${m.pression ? `<span class="tag">${m.pression} bar</span>` : ""}
            ${m.aspect && m.aspect !== "limpide" ? `<span class="tag ${pire}">${m.aspect}</span>` : ""}
            ${(m.contexte || []).map(c => `<span class="tag">${({canicule:"canicule",orage:"orage",forte_baignade:"forte baignade"})[c] || c}</span>`).join("")}
          </div>
        </div>`;
      }).join("");
    },

    /* ---------- ASSISTANT ---------- */
    renderAssistant() {
      const out = document.getElementById("assistant-diagnostic");
      const m = Store.lastMesure();
      if (!m) {
        out.innerHTML = `<p class="empty-note">Enregistre une analyse pour obtenir un diagnostic.</p>`;
      } else {
        const diag = Diagnostic.analyser(m);
        out.innerHTML = diag.conseils.map(c => `
          <div class="advice-item ${c.type === "ok" ? "" : c.type}">
            <span class="advice-dot"></span>
            <p>${c.texte}</p>
          </div>`).join("");
      }

      const topicsEl = document.getElementById("assistant-topics");
      topicsEl.innerHTML = TOPICS.map(t => `
        <div class="accordion-item" data-id="${t.id}">
          <button class="accordion-head" type="button">
            <span>${t.titre}</span>
            <svg class="accordion-chevron" width="16" height="16" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="accordion-body"><div class="accordion-body-inner"><p>${t.reponse}</p></div></div>
        </div>`).join("");
      this._bindAccordion(topicsEl);
    },

    _bindAccordion(container) {
      container.querySelectorAll(".accordion-item").forEach(item => {
        const head = item.querySelector(".accordion-head");
        const body = item.querySelector(".accordion-body");
        head.addEventListener("click", () => {
          const isOpen = item.classList.contains("is-open");
          container.querySelectorAll(".accordion-item.is-open").forEach(other => {
            if (other !== item) { other.classList.remove("is-open"); other.querySelector(".accordion-body").style.maxHeight = null; }
          });
          if (isOpen) { item.classList.remove("is-open"); body.style.maxHeight = null; }
          else { item.classList.add("is-open"); body.style.maxHeight = body.scrollHeight + "px"; }
        });
      });
    },

    /* ---------- CARNET ---------- */
    renderCarnet() {
      const liste = Store.getCarnet();
      const el = document.getElementById("carnet-list");
      if (!liste.length) { el.innerHTML = `<p class="empty-note">Aucune action enregistrée pour le moment.</p>`; return; }
      el.innerHTML = liste.map(e => `
        <div class="entry">
          <div class="entry-top">
            <span class="entry-title">${this.escape(e.type)}</span>
            <span class="entry-date">${this.formatDate(e.date)}</span>
          </div>
          ${e.note ? `<p class="entry-note">${this.escape(e.note)}</p>` : ""}
        </div>`).join("");
    },

    /* ---------- PLUS (guides) ---------- */
    renderPlus() {
      const guidesEl = document.getElementById("guides-list");
      guidesEl.innerHTML = GUIDES.map(g => `
        <div class="accordion-item" data-id="${g.id}">
          <button class="accordion-head" type="button">
            <span>${g.titre}</span>
            <svg class="accordion-chevron" width="16" height="16" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="accordion-body"><div class="accordion-body-inner">${g.contenu}</div></div>
        </div>`).join("");
      this._bindAccordion(guidesEl);
    },

    /* ---------- RÉGLAGES ---------- */
    openSettings() {
      const s = Store.getSettings();
      document.getElementById("set-nom").value = s.nom;
      document.getElementById("set-volume").value = s.volume;
      document.getElementById("set-diametre").value = s.diametre;
      document.getElementById("set-hauteur").value = s.hauteur;
      document.getElementById("set-lat").value = s.lat;
      document.getElementById("set-lon").value = s.lon;
      this.updateVolumePreview();
      document.getElementById("settings-backdrop").hidden = false;
    },
    closeSettings() { document.getElementById("settings-backdrop").hidden = true; },
    updateVolumePreview() {
      const d = parseFloat(document.getElementById("set-diametre").value) || 0;
      const h = parseFloat(document.getElementById("set-hauteur").value) || 0;
      const vGeo = Calc.volumeGeometrique(d, h);
      document.getElementById("set-volume-calc").textContent =
        `Volume géométrique indicatif : ${vGeo.toFixed(2)} m³ (le volume utilisé dans les calculs est celui du champ ci-dessus).`;
    }
  };

  /* =======================================================
     9. INITIALISATION & ÉVÉNEMENTS
     ======================================================= */
  function valOrNull(id) {
    const v = document.getElementById(id).value;
    return v === "" ? null : parseFloat(v);
  }

  function init() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => UI.goTo(btn.dataset.target));
    });
    document.getElementById("btn-quick-entry").addEventListener("click", () => UI.goTo("analyses"));

    document.getElementById("btn-settings").addEventListener("click", () => UI.openSettings());
    document.getElementById("btn-close-settings").addEventListener("click", () => UI.closeSettings());
    document.getElementById("settings-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "settings-backdrop") UI.closeSettings();
    });
    document.getElementById("set-diametre").addEventListener("input", () => UI.updateVolumePreview());
    document.getElementById("set-hauteur").addEventListener("input", () => UI.updateVolumePreview());
    document.getElementById("btn-save-settings").addEventListener("click", () => {
      const volume = parseFloat(document.getElementById("set-volume").value);
      if (!volume || volume <= 0) { UI.toast("Renseigne un volume valide."); return; }
      Store.setSettings({
        nom: document.getElementById("set-nom").value.trim() || "Ma piscine",
        volume,
        diametre: parseFloat(document.getElementById("set-diametre").value) || DEFAULT_SETTINGS.diametre,
        hauteur: parseFloat(document.getElementById("set-hauteur").value) || DEFAULT_SETTINGS.hauteur,
        lat: parseFloat(document.getElementById("set-lat").value) || DEFAULT_SETTINGS.lat,
        lon: parseFloat(document.getElementById("set-lon").value) || DEFAULT_SETTINGS.lon
      });
      Weather.cache = null; // force un nouveau relevé météo si la position a changé
      UI.closeSettings();
      UI.renderAccueil();
      UI.toast("Réglages enregistrés.");
    });

    // Contexte (chips)
    document.querySelectorAll("#contexte-group .chip").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("is-active");
        const ctx = chip.dataset.ctx;
        const idx = UI.contexteSelection.indexOf(ctx);
        if (idx >= 0) UI.contexteSelection.splice(idx, 1); else UI.contexteSelection.push(ctx);
      });
    });

    // Formulaire analyse
    document.getElementById("form-analyse").addEventListener("submit", (e) => {
      e.preventDefault();
      const m = {
        ph: valOrNull("in-ph"),
        chlore: valOrNull("in-chlore"),
        temperature: valOrNull("in-temp"),
        pression: valOrNull("in-pression"),
        aspect: document.getElementById("in-aspect").value,
        contexte: UI.contexteSelection.slice()
      };
      if ([m.ph, m.chlore, m.temperature, m.pression].every(v => v === null)) {
        UI.toast("Renseigne au moins une valeur.");
        return;
      }
      Store.addMesure(m);
      e.target.reset();
      UI.contexteSelection = [];
      document.querySelectorAll("#contexte-group .chip").forEach(c => c.classList.remove("is-active"));
      UI.toast("Analyse enregistrée.");
      UI.goTo("accueil");
    });

    // Formulaire carnet
    document.getElementById("form-carnet").addEventListener("submit", (e) => {
      e.preventDefault();
      Store.addCarnet({
        type: document.getElementById("carnet-type").value,
        note: document.getElementById("carnet-note").value.trim()
      });
      e.target.reset();
      UI.renderCarnet();
      UI.toast("Action ajoutée au carnet.");
    });

    // Calculateurs
    document.getElementById("btn-calc-ph").addEventListener("click", () => {
      const actuel = parseFloat(document.getElementById("calc-ph-actuel").value);
      const cible = parseFloat(document.getElementById("calc-ph-cible").value);
      const res = document.getElementById("res-ph");
      if (isNaN(actuel) || isNaN(cible)) { res.textContent = "Renseigne le pH actuel et le pH cible."; return; }
      const g = Calc.phMoins(actuel, cible);
      res.textContent = g === null
        ? "Le pH actuel est déjà égal ou inférieur au pH cible."
        : `≈ ${g} g de pH- pour ${Calc.volumeActif()} m³ — vérifie la notice du produit et fractionne l'ajout.`;
    });

    document.getElementById("btn-calc-chlore").addEventListener("click", () => {
      const g = Calc.chloreChoc();
      document.getElementById("res-chlore").textContent = `≈ ${g} g pour ${Calc.volumeActif()} m³ — respecte le délai de baignade indiqué sur le produit.`;
    });

    document.getElementById("btn-calc-sel").addEventListener("click", () => {
      const actuel = parseFloat(document.getElementById("calc-sel-actuel").value);
      const cible = parseFloat(document.getElementById("calc-sel-cible").value);
      const res = document.getElementById("res-sel");
      if (isNaN(actuel) || isNaN(cible)) { res.textContent = "Renseigne le taux de sel actuel et cible."; return; }
      const kg = Calc.sel(actuel, cible);
      res.textContent = kg === null
        ? "Le taux de sel actuel est déjà égal ou supérieur à la cible."
        : `≈ ${kg.toFixed(1)} kg de sel pour ${Calc.volumeActif()} m³ — dissous progressivement, filtration en marche.`;
    });

    document.getElementById("btn-calc-filt").addEventListener("click", () => {
      const h = Calc.dureeFiltration(document.getElementById("calc-temp").value);
      document.getElementById("res-filt").textContent = h
        ? `≈ ${h} h de filtration par jour, idéalement fractionnées en journée.`
        : "Renseigne la température de l'eau.";
    });

    document.getElementById("btn-calc-floc").addEventListener("click", () => {
      const { pastilles, dosesLiquide } = Calc.floculant();
      document.getElementById("res-floc").textContent =
        `≈ ${pastilles} pastille(s) ou ${dosesLiquide} dose(s) liquide pour ${Calc.volumeActif()} m³ — vérifie le dosage exact du produit utilisé.`;
    });

    // Export / suppression historique
    document.getElementById("btn-export").addEventListener("click", () => {
      const data = { mesures: Store.getMesures(), carnet: Store.getCarnet(), settings: Store.getSettings() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "poolboy-historique.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
    document.getElementById("btn-clear").addEventListener("click", () => {
      if (confirm("Effacer définitivement toutes les mesures enregistrées ?")) {
        Store.clearMesures();
        UI.renderHistorique();
        UI.renderAccueil();
        UI.toast("Historique effacé.");
      }
    });

    UI.renderAccueil();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // Expose un accès public restreint (utile pour un futur module / hook externe)
  return { Store, Calc, Diagnostic, Charts, Weather, hooks, TOPICS, GUIDES };
})();
