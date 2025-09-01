/* assets/app.js
   Quirk Sight-Unseen Trade Tool
   - VIN decode (NHTSA VPIC) -> prefill Year/Make/Model/Trim
   - Model loader for Make+Year
   - Dealership dropdown (no brand swap; Quirk logo stays constant)
   - Quirk logo SVG injection + recolor
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
// Remove empty file inputs so Netlify doesn't send blank uploads
if (form) {
  form.addEventListener("submit", () => {
    form.querySelectorAll('input[type="file"]').forEach(input => {
      if (!input.files || input.files.length === 0) {
        input.disabled = true; // Netlify ignores disabled inputs
      }
    });
  });
}


/* -------------------- Dealership dropdown (no brand swap) -------------------- */
(function initDealership(){
  const STORAGE_KEY = 'quirk_dealership';
  const el = document.getElementById('dealership');
  if (!el) return;

  // Style placeholder state (CSS will target .placeholder)
  function syncPlaceholderStyle(){
    if (!el.value) el.classList.add('placeholder');
    else el.classList.remove('placeholder');
  }

  // Do NOT restore saved selection on load — keep placeholder & Quirk logo.
  // URL override still allowed: ?dealer=kia, ?dealer=vw, etc.
  const params = new URLSearchParams(location.search);
  const d = params.get('dealer');
  if (d) {
    const map = { chevy:'Chevrolet', chevrolet:'Chevrolet', buick:'Buick GMC', gmc:'Buick GMC', kia:'Kia', vw:'Volkswagen', volkswagen:'Volkswagen' };
    const normalized = map[String(d).toLowerCase()];
    if (normalized) el.value = normalized;
  }

  // Persist new choice when user changes it (no brand swap)
  el.addEventListener('change', () => {
    syncPlaceholderStyle();
    try { localStorage.setItem(STORAGE_KEY, el.value); } catch(_) {}
    // No brand swapping here—Quirk logo stays constant.
  });

  // Initial UI state
  syncPlaceholderStyle();
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
    // ✅ correct VPIC endpoint
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
    // ✅ correct VPIC endpoint
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

    // Load models first, then set Model to ensure it exists in the list
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

    // recolor to brand green
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
/* -------------------- Full i18n: English <-> Spanish -------------------- */
(function i18nQuirk(){
  const LANG_KEY = "quirk_lang";

  // EN -> ES dictionary (keys = stable tokens, not the live text)
  const D = {
    // Headline + intros
    title: ["Sight Unseen Trade-In Appraisal", "Formulario de Tasación sin Inspección"],
    welcome: [
      "Welcome to the Quirk Auto Dealers Sight Unseen Appraisal Program",
      "Bienvenido al programa de tasación sin inspección de Quirk Auto Dealers"
    ],
    instructions: [
      "Please fill out this form with accurate and complete details about your vehicle. The trade-in value we provide will be honored as long as the vehicle condition matches your answers. We'll verify everything when you bring the vehicle in. If the condition differs, the offer will be adjusted accordingly.",
      "Complete este formulario con información precisa y completa sobre su vehículo. El valor de intercambio se respetará siempre que la condición del vehículo coincida con sus respuestas. Verificaremos todo cuando traiga el vehículo. Si la condición difiere, la oferta se ajustará en consecuencia."
    ],

    // Top buttons
    decodeVinBtn: ["Decode VIN & Prefill", "Decodificar VIN y autocompletar"],
    clearBtn:     ["Clear Form", "Limpiar formulario"],

    // Section titles
    aboutYou:     ["Tell us about Yourself", "Cuéntenos sobre usted"],
    vehDetails:   ["Vehicle Details", "Detalles del Vehículo"],
    vehCondition: ["Vehicle Condition", "Condición del Vehículo"],
    wearables:    ["Wearable Items Check", "Revisión de Elementos Desgastables"],
    photos:       ["Photo Uploads (Optional)", "Cargas de Fotos (Opcional)"],
    finalDisclaimerTitle: ["Final Disclaimer", "Descargo de Responsabilidad Final"],

    // Customer info
    nameLabel:   ["Full Name", "Nombre completo"],
    phoneLabel:  ["Phone Number", "Número de teléfono"],
    emailLabel:  ["Email Address", "Correo electrónico"],
    phoneHint:   ["", ""], // keep empty if you don't need a Spanish hint

    // VIN + vehicle
    vinLabel:    ["VIN (required)", "VIN (obligatorio)"],
    vinHint:     ["VIN auto-capitalizes; letters I, O, Q are invalid.", "El VIN se capitaliza automáticamente; las letras I, O y Q no son válidas."],
    mileageLabel:["Current Mileage", "Kilometraje actual"],

    yearLabel:   ["Year", "Año"],
    makeLabel:   ["Make", "Marca"],
    modelLabel:  ["Model", "Modelo"],
    trimLabel:   ["Trim Level (if known)", "Versión (si se conoce)"],
    selectYear:  ["Select Year", "Seleccione año"],
    selectMake:  ["Select Make", "Seleccione marca"],
    selectModel: ["Select Model", "Seleccione modelo"],

    // Colors, title, owners
    extColorLabel: ["Exterior Color", "Color exterior"],
    intColorLabel: ["Interior Color", "Color interior"],
    keysLabel:     ["Number of Keys Included", "Número de llaves incluidas"],
    titleStatus:   ["Title Status", "Estado del título"],
    titleClean:    ["Clean", "Limpio"],
    titleLien:     ["Lien", "Gravamen"],
    titleRebuilt:  ["Rebuilt", "Reconstruido"],
    titleSalvage:  ["Salvage", "Pérdida total"],

    ownersLabel:   ["Number of Owners (estimate OK)", "Número de dueños (estimación aceptable)"],
    accidentLabel: ["Has the vehicle ever been in an accident?", "¿El vehículo ha tenido algún accidente?"],
    accidentRepair:["If yes, was it professionally repaired?", "Si la respuesta es sí, ¿fue reparado profesionalmente?"],

    // Condition
    warnings:     ["Any warning lights on dashboard?", "¿Alguna luz de advertencia en el tablero?"],
    mech:         ["Mechanical issues", "Problemas mecánicos"],
    cosmetic:     ["Cosmetic issues", "Problemas cosméticos"],
    interior:     ["Interior clean and damage-free?", "¿Interior limpio y sin daños?"],
    mods:         ["Aftermarket parts or modifications?", "¿Piezas o modificaciones no originales?"],
    smells:       ["Unusual smells?", "¿Olores inusuales?"],
    service:      ["Routine services up to date?", "¿Servicios de rutina al día?"],

    // Wearables
    tires:        ["Tire Condition", "Estado de los neumáticos"],
    brakes:       ["Brake Condition", "Estado de los frenos"],
    wearOther:    ["Other Wear Items (issues?)", "Otros elementos desgastables (¿problemas?)"],
    New:          ["New", "Nuevos"],
    Good:         ["Good", "Buenos"],
    Worn:         ["Worn", "Gastados"],
    "Needs Replacement": ["Needs Replacement", "Requieren reemplazo"],

    // Photos
    photosExterior:["Exterior Photos", "Fotos del exterior"],
    photosInterior:["Interior Photos", "Fotos del interior"],
    photosDash:    ["Dashboard / Odometer", "Tablero / Odómetro"],
    photosDamage:  ["Damage / Flaws", "Daños / Defectos"],
    photoHint:     ["Max 10MB per file; 24 files total.", "Máx. 10 MB por archivo; 24 archivos en total."],

    // Final / submit
    finalDisclaimer: [
      "I confirm the information provided is accurate to the best of my knowledge. I understand that the appraisal value may change if the vehicle's actual condition does not match the details above.",
      "Confirmo que la información proporcionada es precisa según mi leal saber y entender. Entiendo que el valor de tasación puede cambiar si la condición real del vehículo no coincide con los detalles anteriores."
    ],
    agreeLabel: ["I agree and confirm", "Acepto y confirmo"],
    submit:     ["Get My Trade Appraisal", "Obtener mi tasación"],

    // Placeholders
    vinPlaceholder: ["Enter 17 digit VIN", "Ingrese el VIN de 17 caracteres"],
    mileagePlaceholder: ["e.g., 45000", "p. ej., 45000"],
    phonePlaceholder: ["(###) ###-####", "(###) ###-####"],

    // Dealership dropdown default text
    dealershipPlaceholder: ["Choose Dealership", "Seleccione concesionario"]
  };

  function tr(key, lang){
    const arr = D[key];
    if (!arr) return null;
    return lang === "es" ? arr[1] : arr[0];
  }

  function applyLang(target){
    const lang = (target === "es") ? "es" : "en";
    document.documentElement.setAttribute("lang", lang);

    // Translate elements that have data-i18n="token"
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const token = el.getAttribute("data-i18n").trim();
      const next = tr(token, lang);
      if (!next) return;

      // For option/inputs with placeholder-like content, handle attributes too
      if (el.tagName === "OPTION") {
        el.textContent = next;
      } else {
        el.textContent = next;
      }
    });

    // Placeholders
    const vin = document.getElementById("vin");
    if (vin) vin.setAttribute("placeholder", tr("vinPlaceholder", lang) || vin.getAttribute("placeholder"));

    const mileage = document.getElementById("mileage");
    if (mileage) mileage.setAttribute("placeholder", tr("mileagePlaceholder", lang) || mileage.getAttribute("placeholder"));

    const phone = document.getElementById("phone");
    if (phone) phone.setAttribute("placeholder", tr("phonePlaceholder", lang) || phone.getAttribute("placeholder"));

    // Dealership default option text (if still default)
    const dealer = document.getElementById("dealership");
    if (dealer && dealer.options && dealer.options.length) {
      const first = dealer.options[0];
      if (first && first.disabled) {
        first.textContent = tr("dealershipPlaceholder", lang) || first.textContent;
      }
    }

    // Toggle button label
    const toggle = document.getElementById("langToggle");
    if (toggle) {
      toggle.textContent = (lang === "es") ? "Versión en inglés" : "versión en español";
      toggle.setAttribute("aria-pressed", String(lang === "es"));
      if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    }

    // Persist
    try { localStorage.setItem(LANG_KEY, lang); } catch(_) {}
  }

  // Wire toggle
  const toggle = document.getElementById("langToggle");
  if (toggle) {
    if (!toggle.hasAttribute("type")) toggle.setAttribute("type","button");
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const current = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
      applyLang(current === "en" ? "es" : "en");
    });
  }

  // Initial language: URL ?lang=es > saved > default en
  const params = new URLSearchParams(location.search);
  const urlLang = (params.get("lang") || "").toLowerCase();
  const saved = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
  applyLang(urlLang === "es" || urlLang === "en" ? urlLang : saved);
})();
