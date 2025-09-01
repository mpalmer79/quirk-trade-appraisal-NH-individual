/* assets/app.js
    Quirk Sight-Unseen Trade Tool — VIN decode + Netlify Forms submit
    - Robust VIN decode (NHTSA VPIC) prefills Year/Make/Model/Trim
    - Case-insensitive Make/Model selection; adds option if missing so selection “sticks”
    - Year list & common Make bootstrap if HTML left blank
    - Model loader for Make+Year
    - Spanish toggle (reads/writes localStorage 'quirk_lang')
    - Logo SVG injection + recolor (guarded if dealership brand applied)
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
  const s = String(v).trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
}

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
let yearSel  = document.getElementById("year")  || $('[name="year"]');
let makeSel  = document.getElementById("make")  || $('[name="make"]');
let modelSel = document.getElementById("model") || $('[name="model"]');
let trimInput = document.getElementById("trim") || $('[name="trim"]');

let vinInput  = document.getElementById("vin")  || $('[name="vin"]');
let decodeBtn = document.getElementById("decodeVinBtn") || $('[data-i18n="decodeVinBtn"]');

let modelStatus = document.getElementById("modelStatus") || document.getElementById("model-status");

let form = document.getElementById('tradeForm');

/* -------------------- Dealership dropdown behavior -------------------- */
(function initDealership(){
  const STORAGE_KEY = 'quirk_dealership';
  const el = document.getElementById('dealership');
  if (!el) return;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && [...el.options].some(o => o.value === saved)) el.value = saved;
  } catch(_) {}

  el.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, el.value); } catch(_) {}
    applyBrandFromDealership(el.value);
  });

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
  const src = MAP[val]; if (!src) return;
  slot.innerHTML = '';
  const img = document.createElement('img');
  img.src = src; img.alt = `${val} logo`; img.style.height = '40px'; img.style.width = 'auto';
  slot.setAttribute('data-brand-applied','1');
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
  if (!validVin(vin)) { lastDecodedVin = ""; return; }
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
    if (decYear) setYearSelectValue(yearSel, decYear);
    if (decMake) setSelectValueCaseInsensitive(makeSel, decMake);
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

/* -------------------- Logo injection & recolor -------------------- */
(async function injectAndRecolorQuirkLogo(){
  const slot = document.getElementById('quirkBrand');
  if (!slot) return;
  if (slot.getAttribute('data-brand-applied') === '1') return; // guard if dealership brand applied
  const BRAND_GREEN = '#0b7d2e';
  try {
    const res = await fetch('assets/quirk-logo.svg', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const svgText = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    svg.querySelectorAll('[fill]').forEach(node => { node.setAttribute('fill', BRAND_GREEN); });
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
// (unchanged from your current i18nFull implementation)
