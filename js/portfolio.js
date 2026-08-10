// portfolio.js — wallet holdings with USD value via Helius DAS getAssetsByOwner.
// Read-only. Helius key stored locally.
const KEY_LS = "toolkit_helius_key";
const $ = (id) => document.getElementById(id);
let loading = false;

function setStatus(m, c) { const e = $("status"); e.textContent = m; e.className = c || ""; }
function extractKey(s) { s = (s || "").trim(); const m = s.match(/api-key=([A-Za-z0-9-]+)/); return m ? m[1] : s; }
function usd(n) { n = Number(n) || 0; return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function amt(n) { n = Number(n) || 0; return n.toLocaleString("en-US", { maximumFractionDigits: 4 }); }
function shortMint(m) { return m.slice(0, 4) + "…" + m.slice(-4); }

async function load() {
  if (loading) return;
  loading = true;
  $("btn_load").disabled = true;
  try {
    const addr = $("in_addr").value.trim();
    if (!addr || addr.length < 32) { setStatus("Enter a valid wallet address.", "err"); return; }
    const key = extractKey($("in_key").value);
    if (!key) { setStatus("Paste your Helius API key (or RPC URL).", "err"); return; }
    try { localStorage.setItem(KEY_LS, key); } catch (e) {}

    setStatus("Loading holdings…");
    const body = {
      jsonrpc: "2.0", id: "pf", method: "getAssetsByOwner",
      params: { ownerAddress: addr, page: 1, limit: 1000, displayOptions: { showFungible: true, showNativeBalance: true } },
    };
    const r = await fetch("https://mainnet.helius-rpc.com/?api-key=" + key,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("Helius HTTP " + r.status + (r.status === 401 ? " (bad key)" : ""));
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "RPC error");
    render(j.result || {});
  } catch (e) {
    setStatus("Failed: " + (e.message || e), "err");
  } finally {
    loading = false;
    $("btn_load").disabled = false;
  }
}

function render(res) {
  const items = res.items || [];
  const nb = res.nativeBalance || {};
  const solAmount = (Number(nb.lamports) || 0) / 1e9;
  const solValue = Number(nb.total_price) || (solAmount * (Number(nb.price_per_sol) || 0));

  const tokens = [];
  let nfts = 0;
  for (const it of items) {
    const iface = it.interface || "";
    const ti = it.token_info;
    const isFungible = iface === "FungibleToken" || iface === "FungibleAsset" || (ti && ti.balance != null && (ti.decimals || 0) > 0);
    if (isFungible && ti) {
      const bal = Number(ti.balance) / Math.pow(10, ti.decimals || 0);
      if (!(bal > 0)) continue;
      const price = ti.price_info && ti.price_info.price_per_token;
      const val = ti.price_info && ti.price_info.total_price != null ? Number(ti.price_info.total_price) : (price ? bal * price : 0);
      tokens.push({
        mint: it.id,
        symbol: (ti.symbol || (it.content && it.content.metadata && it.content.metadata.symbol) || "?").slice(0, 12),
        bal, price: Number(price) || 0, val: Number(val) || 0,
      });
    } else {
      nfts++;
    }
  }
  tokens.sort((a, b) => b.val - a.val);
  const tokensVal = tokens.reduce((s, t) => s + t.val, 0);
  const net = solValue + tokensVal;

  $("s_net").textContent = usd(net);
  $("s_sol").textContent = amt(solAmount) + " SOL (" + usd(solValue) + ")";
  $("s_tokens").textContent = tokens.length;
  $("s_nfts").textContent = nfts;

  const grid = $("list");
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  // SOL row first
  frag.appendChild(rowEl("SOL", "So111…1112", amt(solAmount), "", usd(solValue), "So11111111111111111111111111111111111111112"));
  tokens.forEach((t) => frag.appendChild(
    rowEl(t.symbol, shortMint(t.mint), amt(t.bal), t.price ? usd(t.price) : "—", t.val ? usd(t.val) : "—", t.mint)));
  grid.appendChild(frag);
  if (!tokens.length && !solAmount) grid.innerHTML = `<div class="empty">No holdings found for this wallet.</div>`;
  setStatus("Loaded — net worth " + usd(net) + " across " + tokens.length + " tokens.", "ok");
}

function rowEl(sym, mintShort, bal, price, val, mint) {
  const el = document.createElement("div");
  el.className = "hold";
  el.innerHTML = `
    <span class="h-sym">${sym}<span class="h-mint"><a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">${mintShort}</a></span></span>
    <span class="h-bal">${bal}</span>
    <span class="h-price">${price}</span>
    <span class="h-val">${val}</span>`;
  return el;
}

window.addEventListener("DOMContentLoaded", () => {
  try { $("in_key").value = localStorage.getItem(KEY_LS) || ""; } catch (e) {}
  $("btn_load").addEventListener("click", load);
  $("in_addr").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
});
