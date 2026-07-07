// solwatcher.js — live feed of pump.fun graduates (migrated to PumpSwap) above a
// market-cap threshold.
//   • GeckoTerminal (keyless, CORS) → discover the pumpswap pool list (breadth).
//   • DexScreener  (keyless, CORS) → real market cap, liquidity, image, moves.
// GMGN can't be used client-side (Cloudflare challenges every browser request),
// and neither API exposes cumulative "fees paid" — 24h fees are estimated.

const GT = "https://api.geckoterminal.com/api/v2";
const DEX = "pumpswap";
const DS = "https://api.dexscreener.com";
const PUMPSWAP_FEE = 0.0025; // ~0.25% swap fee, used to estimate 24h fees

const $ = (id) => document.getElementById(id);

let timer = null;
let loading = false;
let lastRecords = null; // cache so filter/sort tweaks re-render without refetching

// ── Formatting helpers ─────────────────────────────────────────────────
function fmtUsd(n) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

function fmtPrice(n) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1) return "$" + n.toFixed(3);
  if (n >= 0.001) return "$" + n.toFixed(5);
  const e = Math.floor(Math.log10(n));
  return "$" + n.toFixed(Math.min(12, -e + 3));
}

function fmtSol(n) {
  n = Number(n);
  if (!isFinite(n) || n < 0) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K ◎";
  if (n >= 10) return n.toFixed(0) + " ◎";
  return n.toFixed(1) + " ◎";
}

function pctClass(n) {
  n = Number(n);
  if (!isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function fmtPct(n) {
  n = Number(n);
  if (!isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
}

function ago(iso) {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── Step 1: discover pumpswap graduates via GeckoTerminal ──────────────
async function gtPage(page) {
  const url = `${GT}/networks/solana/dexes/${DEX}/pools` +
    `?page=${page}&sort=h24_volume_usd_desc&include=base_token`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("GeckoTerminal HTTP " + res.status);
  return res.json();
}

async function discover(pages) {
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) => gtPage(i + 1))
  );
  const gt = new Map(); // mint -> fallback fields from GeckoTerminal
  let anyOk = false;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    anyOk = true;
    const tokens = {};
    (r.value.included || []).forEach((t) => { tokens[t.id] = t.attributes; });
    (r.value.data || []).forEach((p) => {
      const a = p.attributes;
      const id = p.relationships?.base_token?.data?.id || "";
      const mint = id.replace(/^solana_/, "");
      if (!mint) return;
      const mc = Number(a.market_cap_usd) || Number(a.fdv_usd) || 0;
      const prev = gt.get(mint);
      if (prev && prev.mcap >= mc) return;
      const tok = tokens["solana_" + mint] || {};
      gt.set(mint, {
        mint,
        symbol: tok.symbol || a.name || "?",
        name: tok.name || "",
        image: tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : "",
        mcap: mc,
        liq: Number(a.reserve_in_usd) || 0,
        price: Number(a.base_token_price_usd) || 0,
        m5: Number(a.price_change_percentage?.m5),
        h1: Number(a.price_change_percentage?.h1),
        h24: Number(a.price_change_percentage?.h24),
        vol24: Number(a.volume_usd?.h24) || 0,
        solUsd: Number(a.quote_token_price_usd) || 0,
        migratedIso: a.pool_created_at,
        pairAddress: a.address,
      });
    });
  }
  if (!anyOk) throw new Error("GeckoTerminal unavailable (rate limit or network).");
  return gt;
}

// ── Step 2: enrich with real market cap / liquidity from DexScreener ────
async function enrich(mints) {
  const map = new Map(); // mint -> best pumpswap pair fields
  const groups = chunk(mints, 30);
  const results = await Promise.allSettled(groups.map((g) =>
    fetch(`${DS}/tokens/v1/solana/${g.join(",")}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : []))
  ));
  for (const r of results) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const p of r.value) {
      const mint = p.baseToken?.address;
      if (!mint) continue;
      const liq = Number(p.liquidity?.usd) || 0;
      const prev = map.get(mint);
      // prefer the pumpswap pair; otherwise the deepest-liquidity pair
      const isPump = p.dexId === "pumpswap";
      if (prev && !(isPump && !prev.isPump) && liq <= prev.liq) continue;
      const priceUsd = Number(p.priceUsd) || 0;
      const priceNative = Number(p.priceNative) || 0;
      map.set(mint, {
        isPump,
        symbol: p.baseToken?.symbol,
        name: p.baseToken?.name,
        image: p.info?.imageUrl || "",
        mcap: Number(p.marketCap) || Number(p.fdv) || 0,
        liq,
        price: priceUsd,
        m5: Number(p.priceChange?.m5),
        h1: Number(p.priceChange?.h1),
        h24: Number(p.priceChange?.h24),
        vol24: Number(p.volume?.h24) || 0,
        solUsd: priceNative > 0 ? priceUsd / priceNative : 0,
        migratedIso: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
        pairAddress: p.pairAddress,
      });
    }
  }
  return map;
}

// Merge GeckoTerminal discovery with DexScreener enrichment (DS wins).
function mergeRecords(gt, ds) {
  const out = [];
  for (const [mint, g] of gt) {
    const d = ds.get(mint) || {};
    const pick = (k, fb) => (d[k] !== undefined && d[k] !== null && d[k] !== "" && !(typeof d[k] === "number" && !isFinite(d[k])) ? d[k] : fb);
    const vol24 = pick("vol24", g.vol24);
    const solUsd = pick("solUsd", g.solUsd);
    out.push({
      mint,
      symbol: (pick("symbol", g.symbol) || "?").toString().slice(0, 14),
      name: (pick("name", g.name) || "").toString().slice(0, 40),
      image: pick("image", g.image),
      mcap: Number(pick("mcap", g.mcap)) || 0,
      liq: Number(pick("liq", g.liq)) || 0,
      price: Number(pick("price", g.price)) || 0,
      m5: Number(pick("m5", g.m5)),
      h1: Number(pick("h1", g.h1)),
      h24: Number(pick("h24", g.h24)),
      vol24: Number(vol24) || 0,
      feesSol: solUsd > 0 ? (Number(vol24) || 0) * PUMPSWAP_FEE / solUsd : 0,
      migratedIso: pick("migratedIso", g.migratedIso),
      pairAddress: pick("pairAddress", g.pairAddress),
    });
  }
  return out;
}

// ── Render ─────────────────────────────────────────────────────────────
function buildCard(r) {
  const el = document.createElement("div");
  el.className = "coin";
  el.innerHTML = `
    <div class="coin-head">
      <div class="coin-logo">${r.image
      ? `<img src="${r.image}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.textContent='◎'">`
      : "◎"}</div>
      <div class="coin-id">
        <div class="coin-sym">${r.symbol}</div>
        <div class="coin-name">${r.name}</div>
      </div>
      <div class="coin-mcap">
        <div class="coin-mcap-v">${fmtUsd(r.mcap)}</div>
        <div class="coin-mcap-l">mcap</div>
      </div>
    </div>
    <div class="coin-stats">
      <div class="cs"><span class="cs-l">price</span><span class="cs-v">${fmtPrice(r.price)}</span></div>
      <div class="cs"><span class="cs-l">liquidity</span><span class="cs-v">${fmtUsd(r.liq)}</span></div>
      <div class="cs"><span class="cs-l">5m</span><span class="cs-v ${pctClass(r.m5)}">${fmtPct(r.m5)}</span></div>
      <div class="cs"><span class="cs-l">1h</span><span class="cs-v ${pctClass(r.h1)}">${fmtPct(r.h1)}</span></div>
      <div class="cs"><span class="cs-l">24h</span><span class="cs-v ${pctClass(r.h24)}">${fmtPct(r.h24)}</span></div>
      <div class="cs"><span class="cs-l">vol 24h</span><span class="cs-v">${fmtUsd(r.vol24)}</span></div>
      <div class="cs"><span class="cs-l">fees 24h</span><span class="cs-v">${fmtSol(r.feesSol)}</span></div>
      <div class="cs"><span class="cs-l">migrated</span><span class="cs-v">${ago(r.migratedIso)} ago</span></div>
    </div>
    <div class="coin-links">
      <a href="https://pump.fun/coin/${r.mint}" target="_blank" rel="noopener">pump.fun ↗</a>
      <a href="https://gmgn.ai/sol/token/${r.mint}" target="_blank" rel="noopener">gmgn ↗</a>
      <a href="https://dexscreener.com/solana/${r.pairAddress || r.mint}" target="_blank" rel="noopener">chart ↗</a>
      <a href="https://solscan.io/token/${r.mint}" target="_blank" rel="noopener">solscan ↗</a>
    </div>`;
  return el;
}

function render(records) {
  const threshold = Number($("in_min").value) || 0;
  const minLiq = Number($("in_liq").value) || 0;
  const minFees = Number($("in_fees").value) || 0;
  const sort = $("sel_sort").value;

  let list = records.filter((r) =>
    r.mcap >= threshold && r.liq >= minLiq && r.feesSol >= minFees);

  list.sort((a, b) => {
    if (sort === "vol") return b.vol24 - a.vol24;
    if (sort === "new") return new Date(b.migratedIso) - new Date(a.migratedIso);
    if (sort === "gain") return (b.h24 || 0) - (a.h24 || 0);
    if (sort === "fees") return b.feesSol - a.feesSol;
    if (sort === "liq") return b.liq - a.liq;
    return b.mcap - a.mcap;
  });

  const grid = $("grid");
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="empty">No graduated coins match these filters right now. Lower a threshold or refresh.</div>`;
  } else {
    const frag = document.createDocumentFragment();
    list.forEach((r) => frag.appendChild(buildCard(r)));
    grid.appendChild(frag);
  }

  const now = new Date().toLocaleTimeString();
  $("s_count").textContent = list.length;
  $("s_updated").textContent = now;
  $("status").textContent =
    `Showing ${list.length} pump.fun graduates ≥ ${fmtUsd(threshold)} · updated ${now}`;
  $("status").className = "ok";
}

// ── Orchestration ──────────────────────────────────────────────────────
async function refresh() {
  if (loading) return;
  loading = true;
  $("btn_refresh").disabled = true;
  if (!$("grid").children.length) $("status").textContent = "Loading pump.fun graduates…";
  $("status").className = "";
  try {
    const pages = Math.min(10, Math.max(1, Number($("in_pages").value) || 5));
    const gt = await discover(pages);
    let ds = new Map();
    try { ds = await enrich([...gt.keys()]); } catch (e) { /* keep GT data if DS fails */ }
    lastRecords = mergeRecords(gt, ds);
    render(lastRecords);
  } catch (e) {
    $("status").textContent = "Error: " + (e.message || e) +
      " — the free APIs are rate-limited; try again shortly.";
    $("status").className = "err";
  } finally {
    loading = false;
    $("btn_refresh").disabled = false;
  }
}

function scheduleAuto() {
  if (timer) { clearInterval(timer); timer = null; }
  if ($("cb_auto").checked) {
    const ms = Math.max(20, Number($("in_every").value) || 45) * 1000;
    timer = setInterval(() => { if (!document.hidden) refresh(); }, ms);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn_refresh").addEventListener("click", refresh);
  // Filter/sort tweaks re-render from cached data — no extra API calls.
  ["in_min", "in_liq", "in_fees", "sel_sort"].forEach((id) =>
    $(id).addEventListener("change", () => { if (lastRecords) render(lastRecords); }));
  refresh();
  scheduleAuto();
  $("cb_auto").addEventListener("change", scheduleAuto);
  $("in_every").addEventListener("change", scheduleAuto);
});
