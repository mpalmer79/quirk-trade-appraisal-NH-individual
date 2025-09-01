/* assets/success.js
   Brand + Language aware success page.
   Reads dealership choice (prefers sessionStorage, then localStorage, then ?dealer=)
   and language (quirk_lang from localStorage or ?lang=) set on the form page.
*/

(function () {
  const DEFAULT = { label: "Quirk Auto", url: "https://www.quirkcars.com" };

  const BRAND = {
    "Chevrolet":  { label: "Quirk Chevrolet",  url: "https://www.quirkchevynh.com" },
    "Buick GMC":  { label: "Quirk Buick GMC",  url: "https://www.quirkbuickgmc.com" },
    "Kia":        { label: "Quirk Kia",        url: "https://www.quirkkianh.com" },
    "Volkswagen": { label: "Quirk Volkswagen", url: "https://www.quirkvwnh.com" }
  };

  function normalizeDealerName(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if (["chevy", "chevrolet"].includes(s)) return "Chevrolet";
    if (["buick", "gmc", "buick gmc", "buick-gmc"].includes(s)) return "Buick GMC";
    if (s === "kia") return "Kia";
    if (["vw", "volkswagen"].includes(s)) return "Volkswagen";
    return null;
  }

  function getDealer() {
    // 1) sessionStorage (set by the form page for this submission)
    try {
      const ss = sessionStorage.getItem("quirk_dealership");
      const n1 = normalizeDealerName(ss);
      if (n1 && BRAND[n1]) return n1;
    } catch (_) {}

    // 2) localStorage (older versions may have used this)
    try {
      const ls = localStorage.getItem("quirk_dealership");
      const n2 = normalizeDealerName(ls);
      if (n2 && BRAND[n2]) return n2;
    } catch (_) {}

    // 3) URL query (?dealer=kia / chevy / buick / vw)
    const p = new URLSearchParams(location.search);
    const fromQuery = normalizeDealerName(p.get("dealer"));
    if (fromQuery && BRAND[fromQuery]) return fromQuery;

    return null;
  }

  function getLanguage() {
    // Prefer localStorage set by the form’s language toggle; fall back to ?lang=.
    try {
      const stored = localStorage.getItem("quirk_lang");
      if (stored === "es" || stored === "en") return stored;
    } catch (_) {}
    const p = new URLSearchParams(location.search);
    const q = (p.get("lang") || "").toLowerCase();
    return q === "es" ? "es" : "en";
  }

  function t(lang, en, es) {
    return lang === "es" ? es : en;
  }

  function applyBrandAndLang() {
    const dealer = getDealer();
    const cfg = dealer ? BRAND[dealer] : DEFAULT;
    const lang = getLanguage();

    // Elements we can customize if present in success/index.html
    const titleEl      = document.getElementById("thanksTitle") || document.querySelector("h1");
    const thankYouMsg  = document.getElementById("thankYouMsg");
    const startOverBtn = document.getElementById("startOverBtn");
    const backBtn      = document.getElementById("backBrandBtn");
    const heroLink     = document.getElementById("heroLink");

    // Title (e.g., "Thank you!")
    if (titleEl) {
      titleEl.textContent = t(lang, "Thank you!", "¡Gracias!");
    }

    // Body text under the title
    if (thankYouMsg) {
      thankYouMsg.textContent = t(
        lang,
        "We received your trade-in details. A Quirk specialist will contact you shortly.",
        "Hemos recibido los detalles de su vehículo. Un especialista de Quirk se pondrá en contacto con usted en breve."
      );
    }

    // "Submit another vehicle" / "Enviar otro vehículo"
    if (startOverBtn) {
      startOverBtn.textContent = t(lang, "Submit another vehicle", "Enviar otro vehículo");
      // Usually this goes back to the root (form). Leave href as provided in HTML.
    }

    // Brand button: if a dealer was chosen, show only the brand label;
    // otherwise show "Back to Quirk Auto" (or its Spanish equivalent).
    if (backBtn) {
      backBtn.textContent = dealer
        ? cfg.label
        : t(lang, `Back to ${DEFAULT.label}`, `Volver a ${DEFAULT.label}`);
      backBtn.setAttribute("href", cfg.url);
    }

    // Make the big "Quirk Works" hero image link to the brand site too
    if (heroLink) {
      heroLink.setAttribute("href", cfg.url);
    }
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBrandAndLang);
  } else {
    applyBrandAndLang();
  }
})();
