const PoolBoy = (() => {
  const VOLUME = 27;
  const PH_MINUS = 75; // g pour 10m3 pour baisser de 0,1
  const CHOC = 100; // g pour 10m3
  const KEY = "my_poolboy_ia_complete_v1";
  let state = JSON.parse(localStorage.getItem(KEY) || '{"analyses":[],"maintenance":[]}');

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

  const $ = id => document.getElementById(id);
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  function go(id, btn){
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if(id === "calculator") renderCalculator();
    if(id === "maintenance") renderHistory();
  }

  function readNumber(id){
    const v = $(id).value;
    return v === "" ? null : parseFloat(v);
  }

  function status(kind, value, waterState){
    if(kind === "water"){
      if(waterState === "Eau parfaite") return "ok";
      if(waterState === "Légèrement trouble") return "warn";
      return "bad";
    }
    if(value === null || Number.isNaN(value)) return "warn";
    if(kind === "ph") return value >= 7.2 && value <= 7.4 ? "ok" : value >= 7 && value <= 7.8 ? "warn" : "bad";
    if(kind === "chlorine") return value >= 1 && value <= 3 ? "ok" : value > 0.3 && value < 5 ? "warn" : "bad";
    if(kind === "temp") return value < 28 ? "ok" : value < 31 ? "warn" : "bad";
    if(kind === "pressure") return value < 0.9 ? "ok" : value < 1.2 ? "warn" : "bad";
    return "ok";
  }

  function metric(label, value, unit, level, message){
    return `<div class="metric ${level}">
      <span>${label}</span><b>${value ?? "—"}${unit || ""}</b><p>${message}</p>
    </div>`;
  }

  function render(){
    const latest = state.analyses[0];
    if(!latest){
      $("metrics").innerHTML = metric("pH","—","","warn","Aucune analyse.") + metric("Chlore","—","","warn","Aucune analyse.");
      $("recommendations").innerHTML = `<div class="alert">Ajoute une analyse pour obtenir un plan d’action personnalisé.</div>`;
      return;
    }

    const levels = {
      ph: status("ph", latest.ph),
      chlorine: status("chlorine", latest.chlorine),
      temp: status("temp", latest.temp),
      pressure: status("pressure", latest.pressure),
      water: status("water", null, latest.waterState)
    };

    let score = 100;
    Object.values(levels).forEach(l => { if(l === "warn") score -= 10; if(l === "bad") score -= 24; });
    score = Math.max(0, score);

    $("healthScore").textContent = score;
    $("swimBadge").textContent = score >= 75 && latest.chlorine <= 3 && latest.ph >= 7 && latest.ph <= 7.8 ? "Baignade OK" : "À vérifier";
    $("healthText").textContent = `${latest.waterState} · ${new Date(latest.date).toLocaleString("fr-FR")}`;

    $("metrics").innerHTML =
      metric("pH", latest.ph, "", levels.ph, levels.ph === "ok" ? "Idéal." : latest.ph > 7.4 ? "Trop haut : chlore moins efficace." : "Trop bas.") +
      metric("Chlore", latest.chlorine, " mg/L", levels.chlorine, levels.chlorine === "ok" ? "Désinfection correcte." : latest.chlorine < 1 ? "Trop faible." : "Trop élevé.") +
      metric("Temp.", latest.temp, "°C", levels.temp, latest.temp >= 31 ? "Canicule : filtrer plus." : "Surveillance simple.") +
      metric("Pression", latest.pressure, " bar", levels.pressure, latest.pressure >= 1 ? "Contre-lavage probable." : "Filtre OK.") +
      metric("Eau", latest.waterState, "", levels.water, levels.water === "ok" ? "Cristalline." : "À surveiller.");

    const recs = [];
    if(latest.ph > 7.4){
      const g = Math.round(((latest.ph - 7.3) * 10) * (PH_MINUS * VOLUME / 10));
      recs.push(`pH haut : ajoute environ <b>${Math.min(g, 500)} g de pH-</b>, filtration 6 h, puis reteste.`);
    }
    if(latest.chlorine !== null && latest.chlorine < 1) recs.push(`Chlore faible : vise <b>1 à 3 mg/L</b>. Pas de baignade si l’eau se trouble fortement.`);
    if(latest.temp >= 30) recs.push(`Eau chaude : filtration recommandée <b>${Math.min(24, Math.round(latest.temp / 2 + 3))} h</b>.`);
    if(latest.pressure >= 1) recs.push(`Pression élevée ou débit faible : fais un <b>contre-lavage + rinçage</b>.`);
    if(latest.waterState === "Légèrement trouble") recs.push(`Eau légèrement trouble : ne rajoute rien si pH/chlore sont bons. Filtration longue + contre-lavage si pression monte.`);
    if(!recs.length) recs.push("Tout est cohérent. Continue la surveillance.");

    $("recommendations").innerHTML = recs.map(r => `<div class="alert">${r}</div>`).join("");
  }

  function saveAnalysis(){
    state.analyses.unshift({
      date: new Date().toISOString(),
      ph: readNumber("ph"),
      chlorine: readNumber("chlorine"),
      temp: readNumber("waterTemp"),
      pressure: readNumber("pressure"),
      waterState: $("waterState").value,
      note: $("note").value
    });
    save(); render();
    alert("Analyse enregistrée");
  }

  function example(){
    $("ph").value = 7.4;
    $("chlorine").value = 1.2;
    $("waterTemp").value = 29;
    $("pressure").value = 0.7;
    $("waterState").value = "Légèrement trouble";
    $("note").value = "Exemple de test";
  }

  function renderCalculator(){
    const type = $("calcType").value;
    const box = $("calcFields");
    $("calcResult").innerHTML = "";
    if(type === "phMinus") box.innerHTML = `<label>pH actuel</label><input id="cph" type="number" step="0.1" placeholder="ex. 7.8"><label>pH cible</label><input id="ctarget" type="number" step="0.1" value="7.3">`;
    if(type === "shock") box.innerHTML = `<p>Chlore choc EDG : 100 g / 10 m³.</p>`;
    if(type === "salt") box.innerHTML = `<p>QS700 Plus : 25 kg pour ton bassin d’environ 27 m³.</p>`;
    if(type === "filtration") box.innerHTML = `<label>Température eau °C</label><input id="ctemp" type="number" step="0.1" placeholder="ex. 29"><label>Conditions</label><select id="condition"><option value="normal">Normal</option><option value="hot">Canicule / forte baignade</option><option value="storm">Après orage</option></select>`;
    if(type === "floc") box.innerHTML = `<p>Floculant uniquement si eau voilée persistante avec pH et chlore corrects.</p>`;
  }

  function calculate(){
    const type = $("calcType").value;
    let html = "";
    if(type === "phMinus"){
      const current = parseFloat($("cph").value);
      const target = parseFloat($("ctarget").value || 7.3);
      const grams = Math.max(0, Math.round(((current - target) * 10) * (PH_MINUS * VOLUME / 10)));
      html = `<b>${grams} g</b><br>Si la dose dépasse 500 g, fais en deux fois et reteste.`;
    }
    if(type === "shock") html = `<b>${Math.round(CHOC * VOLUME / 10)} g</b><br>À faire le soir, filtration en marche.`;
    if(type === "salt") html = `<b>25 kg</b><br>Un seul sac. Ne mets pas 75 kg avec le QS700 Plus.`;
    if(type === "filtration"){
      const t = parseFloat($("ctemp").value || 26);
      let h = Math.round(t / 2);
      const c = $("condition").value;
      if(c === "hot") h += 3;
      if(c === "storm") h += 2;
      html = `<b>${Math.min(24, h)} h</b><br>À répartir surtout sur les heures chaudes.`;
    }
    if(type === "floc") html = `<b>1 cartouche</b><br>Filtration 24 à 48 h puis contre-lavage.`;
    $("calcResult").innerHTML = `<div class="result">${html}</div>`;
  }

  function saveMaintenance(){
    state.maintenance.unshift({
      date: new Date().toISOString(),
      type: $("maintType").value,
      note: $("maintNote").value
    });
    save(); renderHistory();
    alert("Action ajoutée");
  }

  function renderHistory(){
    const items = [];
    state.analyses.forEach(a => items.push({
      date: a.date,
      html: `<b>Analyse eau</b>pH ${a.ph ?? "—"} · Chlore ${a.chlorine ?? "—"} mg/L · Pression ${a.pressure ?? "—"} bar · ${a.waterState}<small>${a.note || ""}</small>`
    }));
    state.maintenance.forEach(m => items.push({
      date: m.date,
      html: `<b>${m.type}</b><small>${m.note || ""}</small>`
    }));
    items.sort((a,b) => new Date(b.date) - new Date(a.date));
    $("history").innerHTML = items.length ? items.map(i => `<div class="item"><small>${new Date(i.date).toLocaleString("fr-FR")}</small>${i.html}</div>`).join("") : "<p>Aucun historique.</p>";
  }

  function clearData(){
    if(confirm("Effacer toutes les données ?")){
      state = {analyses:[], maintenance:[]};
      save(); render(); renderHistory();
    }
  }

  function exportData(){
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "my-poolboy-ia-donnees.json"; a.click();
    URL.revokeObjectURL(url);
  }

  renderCalculator(); render();

  return { go, saveAnalysis, example, renderCalculator, calculate, saveMaintenance, renderHistory, clearData, exportData };
})();