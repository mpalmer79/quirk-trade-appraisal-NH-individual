/* assets/app.js
   Quirk Sight-Unseen Trade Tool
   - VIN decode + model loader (NHTSA VPIC)
   - Dealership dropdown & brand swap
   - English/Spanish toggle (localStorage)
   - Logo SVG injection with dealership guard
*/

/* -------------------- Small utilities -------------------- */
const $ = (sel) => document.querySelector(sel);

function debounce(fn, wait = 500) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
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

/** Ensures numeric year exists in the list; inserts in descending order if needed */
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

/* -------------------- Dealership dropdown behavior -------------------- */
(function initDealership(){
  const STORAGE_KEY = 'quirk_dealership';
  const el = document.getElementById('dealership');
  if (!el) return;

  // restore previous choice (if any)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && [...el.options].some(o => o.value === saved)) el.value = saved;
  } catch(_) {}

  el.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, el.value); } catch(_) {}
    applyBrandFromDealership(el.value);
  });

  // allow URL preselect (?dealer=kia, ?dealer=vw, etc.)
  const params = new URLSearchParams(location.search);
  const d = params.get('dealer');
  if (d) {
    const map = { chevy:'Chevrolet', chevrolet:'Chevrolet', buick:'Buick GMC', gmc:'Buick GMC', kia:'Kia', vw:'Volkswagen', volkswagen:'Volkswagen' };
    const normalized = map[String(d).toLowerCase()];
    if (normalized) {
      el.value = normalized;
      el.dispatchEvent(new Event('change'));
    }
  }

  // initial brand apply
  applyBrandFromDealership(el.value);
})();

function applyBrandFromDealership(val){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;

  const MAP = {
    'Chevrolet'  : 'assets/brands/chevrolet-quirk.svg',
    'Buick GMC'  : 'assets/brands/buick-gmc-quirk.svg',
    'Kia'        : 'assets/brands/kia-quirk.svg',
    'Volkswagen' : 'assets/brands/vw-quirk.svg'
  };
  const src = MAP[val];
  if (!src) return;

  slot.innerHTML = '';
  const img = document.createElement('img');
  img.src = src; img.alt = `${val} logo`; img.style.height = '40px'; img.style.width = 'auto';
  slot.setAttribute('data-brand-applied','1'); // guard for logo recolor
  slot.appendChild(img);
}

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
    // ✅ Correct VPIC endpoint
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
  if (!validVin(vin)) { lastDecodedVin = ""; return; }
  if (vin === lastDecodedVin) return;

  if (vinAborter) vinAborter.abort();
  vinAborter = new AbortController();

  try {
    // ✅ Correct VPIC endpoint
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
    const res = await fetchWithTimeout(url, { timeout: 15000, signal: vinAborter.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const row = (data && data.Results && data.Results[0]) || {};
    const decYear  = row.ModelYear || row.Model_Year || "";
    const decMake  = row.Make || "";
    const decModel = row.Model || row.Model_Name || "";
    const decTrim  = row.Trim || row.Series || "";

    if (decYear) setYearSelectValue(yearSel, decYear);
    if (decMake) setSelectValueCaseInsensitive(makeSel, decMake);

    // load models for the decoded Make+Year first, then set Model
    await loadModels();

    if (decModel) setSelectValueCaseInsensitive(modelSel, decModel);
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

// Normalize VIN input: uppercase & strip I/O/Q/spaces
vinInput?.addEventListener('input', (e)=>{
  e.target.value = String(e.target.value||'').toUpperCase().replace(/[IOQ\s]/g,'');
});

// If a valid VIN is prefilled, try once on load
if (vinInput && validVin(vinInput.value)) decodeVin(vinInput.value);

/* -------------------- Logo injection & recolor (guarded) -------------------- */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;
  if (slot.getAttribute('data-brand-applied') === '1') return; // dealership brand already applied

  const BRAND_GREEN = '#0b7d2e';

  try {
    const res = await fetch('assets/quirk-logo.svg', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const svgText = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;

    // recolor everything to brand green
    svg.querySelectorAll('[fill]').forEach(n => n.setAttribute('fill', BRAND_GREEN));

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

/* -------------------- i18n: English <-> Spanish (compact) -------------------- */
(function i18n(){
  const LANG_KEY = "quirk_lang";
  const map = new Map([
    // keys used with data-i18n="..."
    ["decodeVinBtn",            ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"]],
    ["clearBtn",                ["Clear Form", "Limpiar formulario"]],
    ["esToggle",                ["versión en español", "Versión en inglés"]],
    ["title",                   ["Sight Unseen Trade-In Appraisal", "Tasación de Intercambio sin Inspección"]],
    ["aboutYou",                ["Tell us about Yourself", "Cuéntenos sobre usted"]],
    ["vehicleDetails",          ["Vehicle Details", "Detalles del Vehículo"]],
    ["vinLabel",                ["VIN (required)", "VIN (obligatorio)"]],
    ["selectYear",              ["Select Year", "Seleccione año"]],
    ["selectMake",              ["Select Make", "Seleccione marca"]],
    ["selectModel",             ["Select Model", "Seleccione modelo"]],
  ]);

  function setText(el, en, es, lang){
    const next = (lang === "es") ? es : en;
    if (typeof next === "string" && el.textContent.trim() !== next) el.textContent = next;
  }

  function apply(lang){
    // elements with known keys
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const pair = map.get(key);
      if (!pair) return;
      setText(el, pair[0], pair[1], lang);
    });

    // toggle button text (if present)
    const toggle = document.getElementById("langToggle");
    if (toggle) {
      toggle.textContent = (lang === "es") ? "Versión en inglés" : "versión en español";
      toggle.setAttribute("aria-pressed", String(lang === "es"));
      if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    }

    document.documentElement.setAttribute("lang", lang);
    try { localStorage.setItem(LANG_KEY, lang); } catch(_) {}
  }

  // wire toggle
  const toggle = document.getElementById("langToggle");
  if (toggle) {
    if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const curr = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
      apply(curr === "en" ? "es" : "en");
    });
  }

  // initial lang
  const params = new URLSearchParams(location.search);
  const urlLang = (params.get("lang") || "").toLowerCase();
  const saved   = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
  const start   = (urlLang === "es" || urlLang === "en") ? urlLang : saved;
  apply(start);
})();
