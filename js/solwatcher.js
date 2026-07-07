// solwatcher.js — live feed of pump.fun graduates (migrated to PumpSwap) above a
// market-cap threshold. Data: GeckoTerminal public API (keyless, CORS-enabled).

const GT = "https://api.geckoterminal.com/api/v2";
const DEX = "pumpswap"; // pump.fun tokens land here once they graduate

const $ = (id) => document.getElementById(id);

let timer = null;
let loading = false;

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
  // show first significant digits for tiny prices
  const e = Math.floor(Math.log10(n));
  return "$" + n.toFixed(Math.min(12, -e + 3));
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

function mintOf(pool) {
  const id = pool.relationships?.base_token?.data?.id || "";
  return id.replace(/^solana_/, "");
}

// ── Fetch ──────────────────────────────────────────────────────────────
async function fetchPage(page) {
  const url = `${GT}/networks/solana/dexes/${DEX}/pools` +
    `?page=${page}&sort=h24_volume_usd_desc&include=base_token`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("GeckoTerminal HTTP " + res.status);
  return res.json();
}

async function fetchAll(pages) {
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) => fetchPage(i + 1))
  );
  const pools = [];
  const tokens = {}; // id -> attributes
  let anyOk = false;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    anyOk = true;
    const d = r.value;
    (d.data || []).forEach((p) => pools.push(p));
    (d.included || []).forEach((t) => { tokens[t.id] = t.attributes; });
  }
  if (!anyOk) throw new Error("All GeckoTerminal requests failed (rate limit or network).");
  return { pools, tokens };
}

// ── Render ─────────────────────────────────────────────────────────────
function buildCard(pool, tokens) {
  const a = pool.attributes;
  const mint = mintOf(pool);
  const tok = tokens["solana_" + mint] || {};
  const mcap = Number(a.market_cap_usd) || Number(a.fdv_usd) || 0;
  const sym = (tok.symbol || a.name || "?").toString().slice(0, 14);
  const name = (tok.name || "").toString().slice(0, 40);
  const img = tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : "";
  const pc = a.price_change_percentage || {};
  const vol = a.volume_usd || {};

  const el = document.createElement("div");
  el.className = "coin";
  el.innerHTML = `
    <div class="coin-head">
      <div class="coin-logo">${img
      ? `<img src="${img}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.textContent='◎'">`
      : "◎"}</div>
      <div class="coin-id">
        <div class="coin-sym">${sym}</div>
        <div class="coin-name">${name}</div>
      </div>
      <div class="coin-mcap">
        <div class="coin-mcap-v">${fmtUsd(mcap)}</div>
        <div class="coin-mcap-l">mcap</div>
      </div>
    </div>
    <div class="coin-stats">
      <div class="cs"><span class="cs-l">price</span><span class="cs-v">${fmtPrice(a.base_token_price_usd)}</span></div>
      <div class="cs"><span class="cs-l">5m</span><span class="cs-v ${pctClass(pc.m5)}">${fmtPct(pc.m5)}</span></div>
      <div class="cs"><span class="cs-l">1h</span><span class="cs-v ${pctClass(pc.h1)}">${fmtPct(pc.h1)}</span></div>
      <div class="cs"><span class="cs-l">24h</span><span class="cs-v ${pctClass(pc.h24)}">${fmtPct(pc.h24)}</span></div>
      <div class="cs"><span class="cs-l">vol 24h</span><span class="cs-v">${fmtUsd(vol.h24)}</span></div>
      <div class="cs"><span class="cs-l">migrated</span><span class="cs-v">${ago(a.pool_created_at)} ago</span></div>
    </div>
    <div class="coin-links">
      <a href="https://pump.fun/coin/${mint}" target="_blank" rel="noopener">pump.fun ↗</a>
      <a href="https://gmgn.ai/sol/token/${mint}" target="_blank" rel="noopener">gmgn ↗</a>
      <a href="https://dexscreener.com/solana/${a.address}" target="_blank" rel="noopener">chart ↗</a>
      <a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">solscan ↗</a>
    </div>`;
  return el;
}

function render(data) {
  const threshold = Number($("in_min").value) || 0;
  const sort = $("sel_sort").value;

  // dedupe by mint, keep the pool with the highest market cap / fdv
  const byMint = new Map();
  for (const p of data.pools) {
    const mint = mintOf(p);
    if (!mint) continue;
    const mc = Number(p.attributes.market_cap_usd) || Number(p.attributes.fdv_usd) || 0;
    const prev = byMint.get(mint);
    if (!prev || mc > prev._mc) { p._mc = mc; byMint.set(mint, p); }
  }

  let list = [...byMint.values()].filter((p) => p._mc >= threshold);

  list.sort((x, y) => {
    const ax = x.attributes, ay = y.attributes;
    if (sort === "vol") return (Number(ay.volume_usd?.h24) || 0) - (Number(ax.volume_usd?.h24) || 0);
    if (sort === "new") return new Date(ay.pool_created_at) - new Date(ax.pool_created_at);
    if (sort === "gain") return (Number(ay.price_change_percentage?.h24) || 0) - (Number(ax.price_change_percentage?.h24) || 0);
    return y._mc - x._mc; // mcap
  });

  const grid = $("grid");
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="empty">No graduated coins above ${fmtUsd(threshold)} right now. Lower the threshold or refresh.</div>`;
  } else {
    const frag = document.createDocumentFragment();
    list.forEach((p) => frag.appendChild(buildCard(p, data.tokens)));
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
    const data = await fetchAll(pages);
    render(data);
  } catch (e) {
    $("status").textContent = "Error: " + (e.message || e) +
      " — GeckoTerminal free API is rate-limited (~30 req/min); try again shortly.";
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
  $("in_min").addEventListener("change", () => { if ($("grid").children.length) refresh(); });
  $("sel_sort").addEventListener("change", refresh);
  $("cb_auto").addEventListener("change", scheduleAuto);
  $("in_every").addEventListener("change", scheduleAuto);
  refresh();
  scheduleAuto();
});
