/* assets/success.js
   Brand + Language aware success page.
   Reads dealership (quirk_dealership) and language (quirk_lang) from localStorage.
*/

(function () {
  const DEFAULT = {
    label: "Quirk Auto",
    url: "https://www.quirkcars.com"
  };

  const BRAND = {
    "Chevrolet":  { label: "Quirk Chevrolet",  url: "https://www.quirkchevynh.com" },
    "Buick GMC":  { label: "Quirk Buick GMC",  url: "https://www.quirkbuickgmc.com" },
    "Kia":        { label: "Quirk Kia",        url: "https://www.quirkkianh.com" },
    "Volkswagen": { label: "Quirk Volkswagen", url: "https://www.quirkvwnh.com" }
  };

  function getDealer() {
    const p = new URLSearchParams(location.search);
    const fromQuery = p.get("dealer");
    if (fromQuery && BRAND[fromQuery]) return fromQuery;

    try {
      const saved = localStorage.getItem("quirk_dealership");
      if (saved && BRAND[saved]) return saved;
    } catch(_) {}
    return null;
  }

  function getLanguage() {
    try {
      return localStorage.getItem("quirk_lang") || "en";
    } catch(_) {
      return "en";
    }
  }

  function applyBrandAndLang() {
    const dealer = getDealer();
    const cfg = dealer ? BRAND[dealer] : DEFAULT;
    const lang = getLanguage();

    const backBtn     = document.getElementById("backBrandBtn");
    const startOverBtn = document.getElementById("startOverBtn");
    const hero        = document.getElementById("heroLink");
    const thankYouMsg = document.getElementById("thankYouMsg");

    if (backBtn) {
      if (lang === "es") {
        backBtn.textContent = dealer ? cfg.label : `Volver a ${cfg.label}`;
      } else {
        backBtn.textContent = dealer ? cfg.label : `Back to ${cfg.label}`;
      }
      backBtn.setAttribute("href", cfg.url);
    }

    if (startOverBtn) {
      startOverBtn.textContent = (lang === "es") ? "Enviar otro vehículo" : "Submit another vehicle";
    }

    if (hero) {
      hero.setAttribute("href", cfg.url);
    }

    if (thankYouMsg) {
      thankYouMsg.textContent = (lang === "es")
        ? "Hemos recibido los detalles de su vehículo. Un especialista de Quirk se pondrá en contacto con usted en breve."
        : "We received your trade-in details. A Quirk specialist will contact you shortly.";
    }
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", applyBrandAndLang)
    : applyBrandAndLang();
})();
