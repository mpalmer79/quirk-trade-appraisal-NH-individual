
/* assets/app.js
    Quirk Sight-Unseen Trade Tool — VIN decode + Netlify Forms submit
    - Robust VIN decode (NHTSA VPIC) prefills Year/Make/Model/Trim
    - Case-insensitive Make/Model selection; adds option if missing so selection “sticks”
    - Year list & common Make bootstrap if HTML left blank
    - Model loader for Make+Year
    - Spanish toggle (reads/writes localStorage 'quirk_lang')
    - Logo SVG injection + recolor
*/

/* -------------------- Small utilities -------------------- */
const $ = (sel) => document.querySelector(sel);

function debounce(fn, wait = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 15000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(resource, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function validVin(v) {
  if (!v) return false;
   s = String(v).trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
}

/** Adds/sets select value case-insensitively; creates option if missing */
function setSelectValueCaseInsensitive(selectEl, value) {
  if (!selectEl || value == null) return false;
   target = String(value).trim();
  if (!target) return false;

   lower = target.toLowerCase();
   opts = Array.from(selectEl.options || []);
  let opt = opts.find(
    (o) =>
      String(o.value).toLowerCase() === lower ||
      String(o.textContent).toLowerCase() === lower
  );
  if (!opt) {
    opt = document.createElement("option");
    opt.value = target;
    opt.textContent = target;
    selectEl.appendChild(opt);
  }
  selectEl.value = opt.value;
  return true;
}

/** Ensures numeric year exists in the list; inserts in descending order if needed */
function setYearSelectValue(selectEl, year) {
  if (!selectEl || !year) return false;
   y = String(year).trim();
  if (!y) return false;

  let opt = Array.from(selectEl.options || []).find((o) => String(o.value) === y);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
     asNum = Number(y);
    let inserted = false;
    for (let i = 0; i < selectEl.options.length; i++) {
       n = Number(selectEl.options[i].value);
      if (!Number.isNaN(n) && asNum > n) {
        selectEl.insertBefore(opt, selectEl.options[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) selectEl.appendChild(opt);
  }
  selectEl.value = y;
  return true;
}

/* -------------------- DOM refs -------------------- */
 yearSel  = document.getElementById("year")  || $('[name="year"]');
 makeSel  = document.getElementById("make")  || $('[name="make"]');
 modelSel = document.getElementById("model") || $('[name="model"]');
 trimInput = document.getElementById("trim") || $('[name="trim"]');

 vinInput  = document.getElementById("vin")  || $('[name="vin"]');
 decodeBtn = document.getElementById("decodeVinBtn") || $('[data-i18n="decodeVinBtn"]');

 modelStatus = document.getElementById("modelStatus") || document.getElementById("model-status");

 form = document.getElementById('tradeForm');

/* -------------------- Bootstrap years & makes if empty -------------------- */
(function initYearsIfEmpty() {
  if (!yearSel) return;
  if (yearSel.options && yearSel.options.length > 1) return;
  const now = new Date().getFullYear();
  for (let y = now; y >= 1990; y--) {
    const o = document.createElement("option");
    o.value = String(y);
    o.textContent = String(y);
    yearSel.appendChild(o);
  }
})();

const COMMON_MAKES = [
  "Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC",
  "Genesis","Honda","Hyundai","Infiniti","Jeep","Kia","Land Rover","Lexus","Lincoln",
  "Mazda","Mercedes-Benz","MINI","Nissan","RAM","Subaru","Tesla","Toyota","Volkswagen",
  "Volvo","Porsche"
];

(function initMakesIfEmpty() {
  if (!makeSel) return;
  if (makeSel.options && makeSel.options.length > 1) return;
  COMMON_MAKES.forEach((m) => {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    makeSel.appendChild(o);
  });
})();

/* -------------------- Model loader (Make + Year) -------------------- */
let modelsAborter = null;

function resetModels(disable = true) {
  if (!modelSel) return;
  modelSel.innerHTML = '<option value="">Select Model</option>';
  modelSel.disabled = disable;
  if (modelStatus) modelStatus.textContent = "";
}

async function loadModels() {
  if (!makeSel || !yearSel || !modelSel) return;

  const make = (makeSel.value || "").trim();
  const year = (yearSel.value || "").trim();

  resetModels(true);
  if (!make || !year) return;

  if (modelStatus) modelStatus.textContent = "Loading models…";

  if (modelsAborter) modelsAborter.abort();
  modelsAborter = new AbortController();

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsakeyear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?at=json`;

    const res = await fetchWithTimeout(url, { timeout: 15000, signal: modelsAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models = ((data && data.Results) || [])
      .map((r) => r.Model_Name || r.Model || "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    if (models.length === 0) {
      if (modelStatus) modelStatus.textContent = "No models returned. You can type Trim instead.";
      resetModels(true);
      return;
    }

    models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    });

    modelSel.disabled = false;
    if (modelStatus) modelStatus.textContent = `Loaded ${models.length} models.`;
  } catch (err) {
    if (err.name === "AbortError") return;
    resetModels(true);
    if (modelStatus) modelStatus.textContent = "Could not load models (network issue). Try again or type Trim.";
  } finally {
    modelsAborter = null;
  }
}

makeSel?.addEventListener("change", loadModels);
yearSel?.addEventListener("change", loadModels);

/* -------------------- VIN decode (VPIC) -------------------- */
let vinAborter = null;
let lastDecodedVin = "";

async function decodeVin(vinRaw) {
  if (!vinRaw || !vinInput) return;
  const vin = String(vinRaw).trim().toUpperCase();

  if (!validVin(vin)) {
    lastDecodedVin = "";
    return;
  }
  if (vin === lastDecodedVin) return;

  if (vinAborter) vinAborter.abort();
  vinAborter = new AbortController();

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?at=json`;
    const res = await fetchWithTimeout(url, { timeout: 15000, signal: vinAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const row = (data && data.Results && data.Results[0]) || {};
    const decYear  = row.ModelYear || row.Model_Year || "";
    const decMake  = row.Make || "";
    const decModel = row.Model || "";
    const decTrim  = row.Trim || row.Series || "";

    // 1) Year
    if (decYear) setYearSelectValue(yearSel, decYear);

    // 2) Make (case-insensitive + fallback add)
    if (decMake) setSelectValueCaseInsensitive(makeSel, decMake);

    // 3) Load models for Make+Year before setting Model
    await loadModels();

    // 4) Model
    if (decModel) setSelectValueCaseInsensitive(modelSel, decModel);

    // 5) Trim
    if (trimInput && decTrim) trimInput.value = decTrim;

    lastDecodedVin = vin;
  } catch (err) {
    console.error("VIN decode failed:", err);
  } finally {
    vinAborter = null;
  }
}

/* Hook up decode actions */
decodeBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const v = vinInput?.value || "";
  decodeVin(v);
});

vinInput?.addEventListener(
  "input",
  debounce(() => {
    const v = vinInput.value || "";
    if (validVin(v)) decodeVin(v);
  }, 600)
);

/* NOTE: The JavaScript  submission logic has been removed.
  The  now submits using the standard browser behavior via the 'action'
  attribute in index.html. This is more reliable with Netlify's  detection.
*/

/* -------------------- Logo injection & recolor -------------------- */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;

  const BRAND_GREEN = '#0b7d2e'; // official green; adjust if needed

  try {
    const res = await fetch('assets/quirk-logo.svg', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    // Force all fills to brand green (letters + underline)
    svg.querySelectorAll('[fill]').forEach(node => {
      node.setAttribute('fill', BRAND_GREEN);
    });

    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      if (!svg.getAttribute('width'))  svg.setAttribute('width', 260);
      if (!svg.getAttribute('height')) svg.setAttribute('height', 64);
    }

    slot.innerHTML = '';
    slot.appendChild(svg);
  } catch (err) {
    console.error('Logo load/recolor failed:', err);
    const img = document.createElement('img');
    img.src = 'assets/quirk-logo.svg';
    img.alt = 'Quirk Auto';
    img.style.height = '64px';
    img.style.width  = 'auto';
    slot.innerHTML = '';
    slot.appendChild(img);
  }
})();

/* -------------------- Full- i18n: English <-> Spanish -------------------- */
(function i18nFull(){
  const LANG_KEY = "quirk_lang";

  // Central dictionary. Keys are EN; values are ES.
  const MAP_EN_ES = new Map([
    // Headings / intro
    ["Sight Unseen Trade-In Appraisal", "ulario de Tasación de Intercambio sin Inspección"],
    ["Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program", "Bienvenido al Programa de Tasación sin Inspección de Quirk Auto Dealers"],
    ["Please fill out this  with accurate and complete details about your vehicle. The trade-in value we provide will be honored as long as the vehicle condition matches your answers. We'll verify everything when you bring the vehicle in. If the condition differs, the offer will be adjusted accordingly.",
      "Complete este ulario con inación precisa y completa sobre su vehículo. El valor de intercambio que proporcionamos se respetará siempre que la condición del vehículo coincida con sus respuestas. Verificaremos todo cuando traiga el vehículo. Si la condición difiere, la oferta se ajustará en consecuencia."],
    ["Tell us about Yourself", "Cuéntenos sobre usted"],
    ["Vehicle Details", "Detalles del Vehículo"],
    ["Vehicle Condition", "Condición del Vehículo"],
    ["Wearable Items Check", "Revisión de Elementos Desgastables"],
    ["Photo Uploads (Optional)", "Cargas de Fotos (Opcional)"],
    ["Final Disclaimer", "Descargo de Responsabilidad Final"],

    // Buttons / actions
    ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"],
    ["Clear ", "Limpiar formulario"],
    ["Get My Trade Appraisal", "Obtener mi tasación"],
    ["versión en español", "versión en español"],
    ["English version", "Versión en inglés"],

    // Customer info
    ["Full Name", "Nombre completo"],
    ["Phone Number", "Número de teléfono"],
    ["Email Address", "Correo electrónico"],
    ["(###) ###-####", "(###) ###-####"],

    // VIN section
    ["VIN (required)", "VIN (obligatorio)"],
    ["VIN auto-capitalizes; letters I, O, Q are invalid.", "El VIN se capitaliza automáticamente; las letras I, O y Q no son válidas."],
    ["Enter 17 digit VIN", "Ingrese el VIN de 17 caracteres"],

    // Vehicle detail labels
    ["Current Mileage", "Kilometraje actual"],
    ["Year", "Año"],
    ["Make", "Marca"],
    ["Model", "Modelo"],
    ["Trim Level (if known)", "Versión (si se conoce)"],
    ["Select Year", "Seleccione año"],
    ["Select Make", "Seleccione marca"],
    ["Select Model", "Seleccione modelo"],

    // Colors / misc vehicle
    ["Exterior Color", "Color exterior"],
    ["Interior Color", "Color interior"],
    ["Number of Keys Included", "Número de llaves incluidas"],
    ["Title Status", "Estado del título"],
    ["Clean", "Limpio"],
    ["Lien", "Gravamen"],
    ["Rebuilt", "Reconstruido"],
    ["Salvage", "Pérdida total"],
    ["Number of Owners (estimate OK)", "Número de dueños (estimación aceptable)"],
    ["Has the vehicle ever been in an accident?", "¿El vehículo ha tenido algún accidente?"],
    ["If yes, was it professionally repaired?", "Si la respuesta es sí, ¿fue reparado profesionalmente?"],

    // Condition section
    ["Any warning lights on dashboard?", "¿Alguna luz de advertencia en el tablero?"],
    ["Mechanical issues", "Problemas mecánicos"],
    ["Cosmetic issues", "Problemas cosméticos"],
    ["Interior clean and damage-free?", "¿Interior limpio y sin daños?"],
    ["Aftermarket parts or modifications?", "¿Piezas o modificaciones no originales?"],
    ["Unusual smells?", "¿Olores inusuales?"],
    ["Routine services up to date?", "¿Servicios de rutina al día?"],

    // Wearables
    ["Tire Condition", "Estado de los neumáticos"],
    ["Brake Condition", "Estado de los frenos"],
    ["Other Wear Items (issues?)", "Otros elementos desgastables (¿problemas?)"],
    ["New", "Nuevos"],
    ["Good", "Buenos"],
    ["Worn", "Gastados"],
    ["Needs Replacement", "Requieren reemplazo"],

    // Photos
    ["Exterior Photos", "Fotos del exterior"],
    ["Interior Photos", "Fotos del interior"],
    ["Dashboard / Odometer", "Tablero / Odómetro"],
    ["Damage / Flaws", "Daños / Defectos"],
    ["Max 10MB per file; 24 files total.", "Máx. 10 MB por archivo; 24 archivos en total."],

    // Final section
    ["I confirm the information provided is accurate to the best of my knowledge. I understand that the appraisal value may change if the vehicle's actual condition does not match the details above.",
      "Confirmo que la información proporcionada es precisa según mi leal saber y entender. Entiendo que el valor de tasación puede cambiar si la condición real del vehículo no coincide con los detalles anteriores."],
    ["I agree and confirm", "Acepto y confirmo"],

    // Generic choices
    ["Yes", "Sí"],
    ["No", "No"]
  ]);

  // Build reverse map for ES->EN
  const MAP_ES_EN = new Map(Array.from(MAP_EN_ES.entries()).map(([en, es]) => [es, en]));

  function translateText(str, targetLang){
    if (!str) return str;
    const norm = str.replace(/\s+/g, " ").trim();
    if (!norm) return str;
    if (targetLang === "es") {
      return MAP_EN_ES.get(norm) || str;
    } else {
      return MAP_ES_EN.get(norm) || str;
    }
  }

  function applyLang(target){
    const lang = (target === "es") ? "es" : "en";

    // 1) Elements that have data-i18n: prefer key, else current text
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n").trim();
      const curr = el.textContent.trim();
      const viaKey = translateText(key, lang);
      const viaCurr = translateText(curr, lang);
      const next = (viaKey !== key ? viaKey : viaCurr);
      if (next && next !== curr) el.textContent = next;
    });

    // 2) Generic visible text (labels, headings, buttons, spans, table cells, option text)
    const selectors = [
      "label","legend","h1","h2","h3","h4",
      "button","a.btn","span","p","small","strong","em","th","td","option"
    ];
    document.querySelectorAll(selectors.join(",")).forEach(el => {
      if (el.hasAttribute("data-i18n")) return; // already handled
      // For options and many elements, textContent is appropriate
      const curr = el.textContent ? el.textContent.trim() : "";
      if (!curr) return;
      const next = translateText(curr, lang);
      if (next && next !== curr) el.textContent = next;
    });

    // 3) Placeholders
    document.querySelectorAll("input[placeholder], textarea[placeholder]").forEach(el => {
      const ph = el.getAttribute("placeholder") || "";
      const next = translateText(ph, lang);
      if (next && next !== ph) el.setAttribute("placeholder", next);
    });

    // 4) aria-label / title attributes
    document.querySelectorAll("[aria-label]").forEach(el => {
      const v = el.getAttribute("aria-label");
      const next = translateText(v, lang);
      if (next && next !== v) el.setAttribute("aria-label", next);
    });
    document.querySelectorAll("[title]").forEach(el => {
      const v = el.getAttribute("title");
      const next = translateText(v, lang);
      if (next && next !== v) el.setAttribute("title", next);
    });

    // 5) Language toggle button label + pressed state
    const toggle = document.getElementById("langToggle");
    if (toggle) {
      toggle.textContent = (lang === "es") ? "Versión en inglés" : "versión en español";
      toggle.setAttribute("aria-pressed", String(lang === "es"));
      if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    }

    // 6) Set <html lang> for a11y and persist
    document.documentElement.setAttribute("lang", lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch(_) {}
  }

  // Wire the toggle
  const toggle = document.getElementById("langToggle");
  if (toggle) {
    if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const curr = (localStorage.getItem(LANG_KEY) || "en");
      applyLang(curr === "en" ? "es" : "en");
    });
  }

  // Initial language: URL override (?lang=es) > saved > default en
  const params = new URLSearchParams(location.search);
  const urlLang = params.get("lang");
  const saved = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
  applyLang(urlLang === "es" || urlLang === "en" ? urlLang : saved);
})();

/* ===== VIN Decoder (drop-in) ===== */
(function(){
  // --- small helpers ---
  const $id = (id, name) =>
    document.getElementById(id) || (name ? document.querySelector(`[name="${name}"]`) : null);
  const validVin = (v) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(String(v||'').trim());
  const debounce = (fn, wait=500) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; };

  // --- dom refs (use id or name fallback) ---
  const vinInput  = $id('vin','vin');
  const yearSel   = $id('year','year');
  const makeSel   = $id('make','make');
  const modelSel  = $id('model','model');
  const trimInput = $id('trim','trim');
  const decodeBtn = document.getElementById('decodeVinBtn');

  if (!vinInput || !yearSel || !makeSel || !modelSel) {
    // Required fields not present; bail quietly
    return;
  }

  // keep model list tidy while loading
  const modelStatus = document.getElementById('modelStatus') || document.getElementById('model-status');
  function resetModels(disable=true){
    if (!modelSel) return;
    modelSel.innerHTML = '<option value="">Select Model</option>';
    modelSel.disabled = disable;
    if (modelStatus) modelStatus.textContent = '';
  }

  // case-insensitive setter; creates option if missing
  function setSelectValueCaseInsensitive(selectEl, value){
    if (!selectEl || !value) return;
    const target = String(value).trim();
    const lower  = target.toLowerCase();
    let opt = Array.from(selectEl.options||[]).find(
      o => o.value.toLowerCase() === lower || o.textContent.toLowerCase() === lower
    );
    if (!opt) {
      opt = document.createElement('option');
      opt.value = target; opt.textContent = target;
      selectEl.appendChild(opt);
    }
    selectEl.value = opt.value;
  }

  // ensure year exists (descending list friendly)
  function setYear(selectEl, year){
    if (!selectEl || !year) return;
    const y = String(year).trim();
    let opt = Array.from(selectEl.options||[]).find(o => String(o.value) === y);
    if (!opt) {
      opt = document.createElement('option'); opt.value = y; opt.textContent = y;
      // insert near correct spot if numbers
      const asNum = Number(y);
      let inserted = false;
      for (let i=0;i<selectEl.options.length;i++){
        const n = Number(selectEl.options[i].value);
        if (!Number.isNaN(n) && asNum > n){ selectEl.insertBefore(opt, selectEl.options[i]); inserted = true; break; }
      }
      if (!inserted) selectEl.appendChild(opt);
    }
    selectEl.value = y;
  }

  let modelsAborter = null;
  async function loadModelsFor(make, year){
    resetModels(true);
    if (!make || !year) return;
    if (modelStatus) modelStatus.textContent = 'Loading models…';
    if (modelsAborter) modelsAborter.abort();
    modelsAborter = new AbortController();
    try{
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/makeyear/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`;
      const res = await fetch(url, { signal: modelsAborter.signal });
      const data = await res.json();
      const list = (data.Results||[])
        .map(r => r.Model_Name || r.Model || '')
        .filter(Boolean)
        .sort((a,b)=>a.localeCompare(b, undefined, { sensitivity:'base' }));
      if (!list.length){
        if (modelStatus) modelStatus.textContent = 'No models found. You can type Trim.';
        resetModels(true); return;
      }
      list.forEach(m=>{
        const o=document.createElement('option'); o.value=m; o.textContent=m; modelSel.appendChild(o);
      });
      modelSel.disabled = false;
      if (modelStatus) modelStatus.textContent = `${list.length} models found.`;
    } catch {
      resetModels(true);
      if (modelStatus) modelStatus.textContent = 'Could not load models.';
    } finally { modelsAborter = null; }
  }

  let vinAborter = null;
  let lastDecoded = '';
  async function decodeVinNow(vinRaw){
    const vin = String(vinRaw||'').trim().toUpperCase();
    if (!validVin(vin)) { lastDecoded=''; return; }
    if (vin === lastDecoded) return;

    if (vinAborter) vinAborter.abort();
    vinAborter = new AbortController();

    try{
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
      const res = await fetch(url, { signal: vinAborter.signal });
      const data = await res.json();
      const row = (data && data.Results && data.Results[0]) || {};

      const yr   = row.ModelYear || row.Model_Year || '';
      const make = row.Make || '';
      const model= row.Model || row.Model_Name || '';
      const trim = row.Trim || row.Series || '';

      if (yr)   setYear(yearSel, yr);
      if (make) setSelectValueCaseInsensitive(makeSel, make);

      await loadModelsFor(makeSel.value, yearSel.value);

      if (model) setSelectValueCaseInsensitive(modelSel, model);
      if (trimInput && trim && !trimInput.value) trimInput.value = trim;

      lastDecoded = vin;
    } catch {
      // swallow; keep form usable
    } finally { vinAborter = null; }
  }

  // wire events
  if (decodeBtn) decodeBtn.addEventListener('click', (e)=>{ e.preventDefault(); decodeVinNow(vinInput.value); });
  vinInput.addEventListener('input', debounce(()=> decodeVinNow(vinInput.value), 600));

  // normalize VIN input: uppercase & strip I/O/Q/spaces
  vinInput.addEventListener('input', (e)=>{
    e.target.value = String(e.target.value||'').toUpperCase().replace(/[IOQ\s]/g,'');
  });

  // if prefilling, try once on load
  if (validVin(vinInput.value)) decodeVinNow(vinInput.value);
})();
