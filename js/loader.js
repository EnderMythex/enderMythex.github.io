// loader.js — pixel-grid loading indicator (vanilla port of the React version):
// a 3x3 grid with a chevron wavefront, a shimmering label and a live elapsed
// timer. Exposes window.showLoader(id, label) / window.hideLoader(id).
(function () {
  // chevron wavefront delays, per cell (row/col based)
  const CHEVRON = Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    return (c + Math.abs(r - 1)) * 90;
  });

  function createLoader(label, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "pixel-loader";

    const grid = document.createElement("span");
    grid.className = "pl-grid";
    grid.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("span");
      cell.className = "pl-cell" + (opts.round ? " round" : "");
      cell.style.animationDelay = CHEVRON[i] + "ms";
      grid.appendChild(cell);
    }

    const lbl = document.createElement("span");
    lbl.className = "pl-label";
    lbl.textContent = label || "Loading";

    const timer = document.createElement("span");
    timer.className = "pl-timer";
    timer.textContent = "0.0s";

    el.append(grid, lbl, timer);

    const start = Date.now();
    const iv = setInterval(() => {
      const t = (Date.now() - start) / 1000;
      timer.textContent = t < 60 ? t.toFixed(1) + "s" : Math.floor(t / 60) + "m " + (t % 60).toFixed(1) + "s";
    }, 100);

    el.stop = () => clearInterval(iv);
    el.setLabel = (txt) => { lbl.textContent = txt; };
    return el;
  }

  window.showLoader = function (id, label, opts) {
    const s = document.getElementById(id);
    if (!s) return null;
    window.hideLoader(id);
    s.className = "";
    s.textContent = "";
    const l = createLoader(label, opts);
    s.appendChild(l);
    s._loader = l;
    return l;
  };

  window.hideLoader = function (id) {
    const s = document.getElementById(id);
    if (s && s._loader) { s._loader.stop(); s._loader = null; }
  };

  window.createLoader = createLoader;

  // ── Full-screen page-transition loader ────────────────────────────────
  // Shows a centered loader while navigating to another page of the site,
  // and clears it when the new page is shown.
  function overlay() {
    let o = document.getElementById("page-loader");
    if (!o) {
      o = document.createElement("div");
      o.id = "page-loader";
      const box = document.createElement("div");
      box.className = "pl-center";
      box.appendChild(createLoader("Loading"));
      o.appendChild(box);
      (document.body || document.documentElement).appendChild(o);
    }
    return o;
  }
  function showPage() { overlay().classList.add("show"); }
  function hidePage() { const o = document.getElementById("page-loader"); if (o) o.classList.remove("show"); }
  window.showPageLoader = showPage;

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    if (!href || href.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(href)) return;
    if (!/\.html($|[?#])/i.test(href)) return; // only same-site page switches
    showPage();
  }, true);

  // clear the overlay when arriving (incl. back/forward bfcache restores)
  window.addEventListener("pageshow", hidePage);
})();
