/* assets/app.js
   Quirk Sight-Unseen Trade Tool
   - VIN decode (NHTSA VPIC) to prefill Year / Make / Model / Trim
   - Make/Model loading for chosen Year+Make
   - Case-insensitive select setting (adds option if missing so the value “sticks”)
   - Language toggle (English ↔ Español) persisted in localStorage('quirk_lang')
   - Dealership dropdown persisted in localStorage('quirk_dealership')
   - Captures UTM + referrer fields
   - Prevents empty file inputs from being posted (stops “tiny blank uploads” emails)
*/

/* -------------------- tiny helpers -------------------- */
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
  const s = String(v).trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
}

/** Adds/sets select value case-insensitively; creates option if missing */
function setSelectValueCaseInsensitive(selectEl, value) {
  if (!selectEl || value == null) return false;
  const target = String(value).trim();
  if (!target) return false;

  const lower = target.toLowerCase();
  const opts = Array.from(selectEl.options || []);
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

/** Ensures numeric year exists; inserts in descending order if needed */
function setYearSelectValue(selectEl, year) {
  if (!selectEl || !year) return false;
  const y = String(year).trim();
  if (!y) return false;

  let opt = Array.from(selectEl.options || []).find((o) => String(o.value) === y);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    const asNum = Number(y);
    let inserted = false;
    for (let i = 0; i < selectEl.options.length; i++) {
      const n = Number(selectEl.options[i].value);
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
let yearSel   = document.getElementById("year")   || $('[name="year"]');
let makeSel   = document.getElementById("make")   || $('[name="make"]');
let modelSel  = document.getElementById("model")  || $('[name="model"]');
let trimInput = document.getElementById("trim")   || $('[name="trim"]');

let vinInput  = document.getElementById("vin")    || $('[name="vin"]');
let decodeBtn = document.getElementById("decodeVinBtn") || $('[data-i18n="decodeVinBtn"]');

let modelStatus = document.getElementById("modelStatus") || document.getElementById("model-status");

let form = document.getElementById('tradeForm');

/* -------------------- Dealership dropdown (persist only) -------------------- */
(function initDealership(){
  const STORAGE_KEY = 'quirk_dealership';
  const el = document.getElementById('dealership');
  if (!el) return;

  // Restore previous choice (if any)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && [...el.options].some(o => o.value === saved)) {
      el.value = saved;
    }
  } catch(_) {}

  // Persist new choice
  el.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, el.value); } catch(_) {}
  });

  // Optional URL preselect, e.g. ?dealer=kia
  const params = new URLSearchParams(location.search);
  const d = params.get('dealer');
  if (d) {
    const map = {
      chevy:'Chevrolet', chevrolet:'Chevrolet',
      buick:'Buick GMC', gmc:'Buick GMC',
      kia:'Kia',
      vw:'Volkswagen', volkswagen:'Volkswagen'
    };
    const normalized = map[String(d).toLowerCase()];
    if (normalized && [...el.options].some(o => o.value === normalized)) {
      el.value = normalized;
      try { localStorage.setItem(STORAGE_KEY, normalized); } catch(_) {}
    }
  }
})();

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
    // VPIC: get models for a make+year
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/makeyear/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`;

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
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
    const res = await fetchWithTimeout(url, { timeout: 15000, signal: vinAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const row = (data && data.Results && data.Results[0]) || {};
    const decYear  = row.ModelYear || row.Model_Year || "";
    const decMake  = row.Make || "";
    const decModel = row.Model || "";
    const decTrim  = row.Trim || row.Series || "";

    if (decYear)  setYearSelectValue(yearSel, decYear);
    if (decMake)  setSelectValueCaseInsensitive(makeSel, decMake);

    // Load models for Make+Year before setting Model
    await loadModels();

    if (decModel) setSelectValueCaseInsensitive(modelSel, decModel);
    if (trimInput && decTrim && !trimInput.value) trimInput.value = decTrim;

    lastDecodedVin = vin;
  } catch (err) {
    console.error("VIN decode failed:", err);
  } finally {
    vinAborter = null;
  }
}

/* Hook up VIN decode actions */
decodeBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const v = vinInput?.value || "";
  decodeVin(v);
});

if (vinInput) {
  // Normalize typing + debounce decode
  vinInput.addEventListener('input', (e) => {
    e.target.value = String(e.target.value || '').toUpperCase().replace(/[IOQ\s]/g,'');
  });

  vinInput.addEventListener(
    "input",
    debounce(() => {
      const v = vinInput.value || "";
      if (validVin(v)) decodeVin(v);
    }, 600)
  );
}

/* -------------------- Quirk logo injection & recolor (always visible) -------------------- */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;

  const BRAND_GREEN = '#0b7d2e';

  try {
    const res = await fetch('assets/quirk-logo.svg', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    // Force fills to brand green
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

/* -------------------- i18n: English <-> Spanish -------------------- */
(function i18nFull(){
  const LANG_KEY = "quirk_lang";

  // EN → ES dictionary (keys are EN)
  const MAP_EN_ES = new Map([
    // Headings / intro
    ["Sight Unseen Trade-In Appraisal", "Tasación de intercambio sin inspección"],
    ["Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program", "Bienvenido al programa de tasación sin inspección de Quirk Auto Dealers"],
    ["Please fill out this form with accurate and complete details about your vehicle. The trade-in value we provide will be honored as long as the vehicle condition matches your answers. We'll verify everything when you bring the vehicle in. If the condition differs, the offer will be adjusted accordingly.",
      "Complete este formulario con información precisa y completa sobre su vehículo. El valor de canje se respetará siempre que la condición del vehículo coincida con sus respuestas. Verificaremos todo cuando traiga el vehículo. Si la condición difiere, la oferta se ajustará en consecuencia."],
    ["Tell us about Yourself", "Cuéntenos sobre usted"],
    ["Vehicle Details", "Detalles del vehículo"],
    ["Vehicle Condition", "Condición del vehículo"],
    ["Wearable Items Check", "Revisión de elementos desgastables"],
    ["Photo Uploads (Optional)", "Cargas de fotos (opcional)"],
    ["Final Disclaimer", "Descargo de responsabilidad final"],

    // Buttons / actions
    ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"],
    ["Clear Form", "Limpiar formulario"],
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
    ["VIN auto-capitalizes; letters I, O, Q are invalid.", "El VIN se escribe en mayúsculas; las letras I, O y Q no son válidas."],
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
    ["Dashboard / Odometer", "Tablero / odómetro"],
    ["Damage / Flaws", "Daños / defectos"],
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

    // Elements with data-i18n: translate based on the key (attribute) first, then fallback to current text
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n").trim();
      const curr = (el.textContent || "").trim();
      const viaKey = translateText(key, lang);
      const viaCurr = translateText(curr, lang);
      const next = (viaKey !== key ? viaKey : viaCurr);
      if (next && next !== curr) el.textContent = next;
    });

    // Placeholders
    document.querySelectorAll("input[placeholder], textarea[placeholder]").forEach(el => {
      const ph = el.getAttribute("placeholder") || "";
      const next = translateText(ph, lang);
      if (next && next !== ph) el.setAttribute("placeholder", next);
    });

    // aria-label / title
    document.querySelectorAll("[aria-label]").forEach(el => {
      const v = el.getAttribute("aria-label");
      const n = translateText(v, lang);
      if (n && n !== v) el.setAttribute("aria-label", n);
    });
    document.querySelectorAll("[title]").forEach(el => {
      const v = el.getAttribute("title");
      const n = translateText(v, lang);
      if (n && n !== v) el.setAttribute("title", n);
    });

    // Language toggle label + pressed state
    const toggle = document.getElementById("langToggle");
    if (toggle) {
      toggle.textContent = (lang === "es") ? "Versión en inglés" : "versión en español";
      toggle.setAttribute("aria-pressed", String(lang === "es"));
      if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    }

    // Set <html lang> and persist
    document.documentElement.setAttribute("lang", lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch(_) {}
  }

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

/* -------------------- UTM + referrer capture -------------------- */
(function captureAttribution(){
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

  try {
    setVal('referrer', document.referrer || '');
    setVal('landingPage', window.location.href || '');

    const p = new URLSearchParams(window.location.search);
    setVal('utmSource',   p.get('utm_source')   || '');
    setVal('utmMedium',   p.get('utm_medium')   || '');
    setVal('utmCampaign', p.get('utm_campaign') || '');
    setVal('utmTerm',     p.get('utm_term')     || '');
    setVal('utmContent',  p.get('utm_content')  || '');
  } catch(_){}
})();

/* -------------------- Clear form button -------------------- */
(function hookClear(){
  const btn = document.getElementById('clearBtn');
  if (!btn || !form) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    form.reset();
    // Reset models list
    resetModels(true);
  });
})();

/* -------------------- Before submit: sanitize & drop empty file inputs -------------------- */
(function hookSubmit(){
  if (!form) return;
  form.addEventListener('submit', () => {
    // phoneRaw: digits only version
    const phone = document.getElementById('phone');
    const phoneRaw = document.getElementById('phoneRaw');
    if (phone && phoneRaw) {
      phoneRaw.value = (phone.value || '').replace(/\D+/g,'');
    }

    // Remove empty file inputs to prevent blank attachments
    form.querySelectorAll('input[type="file"]').forEach(input => {
      if (!input.files || input.files.length === 0) {
        input.parentNode && input.parentNode.removeChild(input);
      }
    });
  });
})();
