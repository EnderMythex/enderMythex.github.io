// solwatcher.js — live feed of pump.fun graduates (migrated to PumpSwap) above a
// market-cap threshold.
//   • GeckoTerminal (keyless, CORS) → discover the pumpswap pool list (breadth).
//   • DexScreener  (keyless, CORS) → real market cap, liquidity, image, moves.
// GMGN can't be used client-side (Cloudflare challenges every browser request),
// and neither API exposes cumulative "fees paid" — 24h fees are estimated.

const GT = "https://api.geckoterminal.com/api/v2";
const DEX = "pumpswap";
const DS = "https://api.dexscreener.com";
const BIRDEYE = "https://public-api.birdeye.so";
const KEY_LS = "solwatcher_birdeye_key";
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

// Primary, reliable discovery: DexScreener search returns the top PumpSwap
// pairs with solid CORS and no aggressive rate limiting. We only keep
// pump.fun mints (ending in "pump").
async function dsSearchMints() {
  const out = new Set();
  const res = await fetch(`${DS}/latest/dex/search?q=pumpswap`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("DexScreener HTTP " + res.status);
  const j = await res.json();
  (j.pairs || []).forEach((p) => {
    if (p.chainId !== "solana" || p.dexId !== "pumpswap") return;
    const m = p.baseToken?.address;
    if (m && m.endsWith("pump")) out.add(m);
  });
  return out;
}

// Optional extra breadth from GeckoTerminal. Best-effort only: its error/
// rate-limit responses omit CORS headers, so any failure here is swallowed and
// must never break the page.
async function gtDiscoverMints(pages) {
  const out = new Set();
  if (pages < 1) return out;
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) => gtPage(i + 1))
  );
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    (r.value.data || []).forEach((p) => {
      const mint = (p.relationships?.base_token?.data?.id || "").replace(/^solana_/, "");
      if (mint && mint.endsWith("pump")) out.add(mint);
    });
  }
  return out;
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
      // keep the deepest-liquidity pair (tie-break to the pumpswap pool) so a
      // token whose pumpswap pool is drained still shows its real liquidity
      const isPump = p.dexId === "pumpswap";
      if (prev) {
        if (liq < prev.liq) continue;
        if (liq === prev.liq && !(isPump && !prev.isPump)) continue;
      }
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

// Build records straight from DexScreener data (the source of truth for market
// cap / liquidity / price). Every listed coin is therefore confirmed by
// DexScreener, so its displayed numbers match its real on-chain token page.
function buildRecords(ds) {
  let globalSol = 0;
  for (const d of ds.values()) if (Number(d.solUsd) > 0) { globalSol = Number(d.solUsd); break; }

  const out = [];
  for (const [mint, d] of ds) {
    if (!mint.endsWith("pump")) continue; // pump.fun only
    const solUsd = Number(d.solUsd) > 0 ? Number(d.solUsd) : globalSol;
    const vol24 = Number(d.vol24) || 0;
    out.push({
      mint,
      symbol: (d.symbol || "?").toString().slice(0, 14),
      name: (d.name || "").toString().slice(0, 40),
      image: d.image || "",
      mcap: Number(d.mcap) || 0,
      liq: Number(d.liq) || 0,
      price: Number(d.price) || 0,
      m5: Number(d.m5),
      h1: Number(d.h1),
      h24: Number(d.h24),
      vol24,
      feesSol: solUsd > 0 ? vol24 * PUMPSWAP_FEE / solUsd : 0,
      migratedIso: d.migratedIso,
      pairAddress: d.pairAddress,
    });
  }
  return out;
}

// ── Optional: overlay authoritative data from the user's Birdeye key ───
// Purely additive — every field falls back to the existing value, so a bad
// key or a changed response shape can never break the board.
async function birdeyeOverlay(records, key) {
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : undefined; };
  // only the strongest candidates, to stay light on the user's quota
  const top = records.filter((r) => r.mcap > 0).sort((a, b) => b.mcap - a.mcap).slice(0, 40);
  let i = 0, hits = 0;
  const CONCURRENCY = 4;
  async function worker() {
    while (i < top.length) {
      const r = top[i++];
      try {
        const res = await fetch(`${BIRDEYE}/defi/token_overview?address=${r.mint}`,
          { headers: { "X-API-KEY": key, "x-chain": "solana", Accept: "application/json" } });
        if (!res.ok) continue;
        const j = await res.json();
        const d = j && j.data;
        if (!d) continue;
        const mc = num(d.realMc) ?? num(d.mc); if (mc) r.mcap = mc;
        const liq = num(d.liquidity); if (liq != null) r.liq = liq;
        const price = num(d.price); if (price) r.price = price;
        const vol = num(d.v24hUSD);
        if (vol != null) { r.vol24 = vol; if (r.solUsd > 0) r.feesSol = vol * PUMPSWAP_FEE / r.solUsd; }
        const h24 = num(d.priceChange24hPercent); if (h24 != null) r.h24 = h24;
        const h1 = num(d.priceChange1hPercent); if (h1 != null) r.h1 = h1;
        const m5 = num(d.priceChange30mPercent); if (m5 != null) r.m5 = m5;
        if (d.logoURI) r.image = d.image || d.logoURI;
        r._birdeye = true;
        hits++;
      } catch (e) { /* ignore, keep existing values */ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return hits;
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
  if (window.hideLoader) window.hideLoader("status");
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
  const viaBirdeye = list.some((r) => r._birdeye);
  $("s_count").textContent = list.length;
  $("s_updated").textContent = now;
  $("status").textContent =
    `Showing ${list.length} pump.fun graduates ≥ ${fmtUsd(threshold)} · updated ${now}` +
    (viaBirdeye ? " · Birdeye key active ✓" : "");
  $("status").className = "ok";
}

// ── Orchestration ──────────────────────────────────────────────────────
async function refresh() {
  if (loading) return;
  loading = true;
  $("btn_refresh").disabled = true;
  // show the loader only when there's no list yet (avoid flicker on auto-refresh)
  if (!$("grid").children.length && window.showLoader) window.showLoader("status", "Loading pump.fun graduates…");
  else $("status").className = "";
  try {
    const pages = Math.min(10, Math.max(0, Number($("in_pages").value) || 0));
    // Reliable primary discovery (DexScreener) + optional GeckoTerminal breadth.
    const mints = new Set();
    let primaryOk = false;
    try { (await dsSearchMints()).forEach((m) => mints.add(m)); primaryOk = true; } catch (e) {}
    try { (await gtDiscoverMints(pages)).forEach((m) => mints.add(m)); } catch (e) {}
    if (!mints.size) {
      if (!primaryOk) throw new Error("DexScreener unreachable — check your connection.");
      throw new Error("No pump.fun graduates found right now.");
    }
    const ds = await enrich([...mints]);
    const records = buildRecords(ds);
    const key = $("in_key").value.trim();
    if (key) {
      try { await birdeyeOverlay(records, key); } catch (e) { /* keep DexScreener data */ }
    }
    lastRecords = records;
    render(records);
  } catch (e) {
    if (window.hideLoader) window.hideLoader("status");
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
  // restore a previously saved Birdeye key (local only)
  try { $("in_key").value = localStorage.getItem(KEY_LS) || ""; } catch (e) {}

  $("btn_refresh").addEventListener("click", refresh);
  // Filter tweaks re-render instantly from cached data — no extra API calls.
  // Use "input" (fires as you type/spin) so the list updates immediately.
  ["in_min", "in_liq", "in_fees"].forEach((id) =>
    $(id).addEventListener("input", () => { if (lastRecords) render(lastRecords); }));
  $("sel_sort").addEventListener("change", () => { if (lastRecords) render(lastRecords); });
  // Persist the key and refetch (with Birdeye) when it changes.
  $("in_key").addEventListener("change", () => {
    try { localStorage.setItem(KEY_LS, $("in_key").value.trim()); } catch (e) {}
    refresh();
  });
  refresh();
  scheduleAuto();
  $("cb_auto").addEventListener("change", scheduleAuto);
  $("in_every").addEventListener("change", scheduleAuto);
});
