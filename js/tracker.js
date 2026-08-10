// tracker.js — follow the money: scan a wallet's history and show where it sent
// the biggest part of its funds (aggregated outgoing SOL by destination).
// Uses the Helius Enhanced Transactions API (parsed transfers). Read-only.

const KEY_LS = "toolkit_helius_key";
const LAMPORTS_PER_SOL = 1e9;

const $ = (id) => document.getElementById(id);
let loading = false;

function setStatus(msg, cls) {
  const el = $("status");
  el.textContent = msg;
  el.className = cls || "";
}

function extractKey(s) {
  s = (s || "").trim();
  const m = s.match(/api-key=([A-Za-z0-9-]+)/);
  return m ? m[1] : s;
}

function shortAddr(a) { return a.slice(0, 4) + "…" + a.slice(-4); }
function fmtSol(n) { return (n / LAMPORTS_PER_SOL).toLocaleString("en-US", { maximumFractionDigits: 3 }); }
function fmtDate(ts) { return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "—"; }

async function fetchPage(addr, key, before) {
  let url = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${key}&limit=100`;
  if (before) url += `&before=${before}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("Helius HTTP " + r.status + (r.status === 401 ? " (bad API key)" : ""));
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(j.error || "Unexpected response");
  return j;
}

async function track() {
  if (loading) return;
  loading = true;
  $("btn_track").disabled = true;
  try {
    const addr = $("in_addr").value.trim();
    if (!addr || addr.length < 32) { setStatus("Enter a valid wallet address.", "err"); return; }
    const key = extractKey($("in_key").value);
    if (!key) { setStatus("Paste your Helius API key (or full RPC URL).", "err"); return; }
    try { localStorage.setItem(KEY_LS, key); } catch (e) {}

    const pages = Math.min(20, Math.max(1, Number($("in_pages").value) || 5));

    const outSol = new Map();   // dest -> lamports sent out
    const outCount = new Map();  // dest -> tx count
    const outLast = new Map();   // dest -> last timestamp
    const tokenOut = new Map();  // dest -> token-transfer count
    const sources = new Set();   // platforms Helius recognised (JUPITER, PUMP_FUN…)
    let inSol = 0, totalOut = 0, scanned = 0, before = null;

    for (let p = 0; p < pages; p++) {
      setStatus("Scanning transactions… page " + (p + 1) + "/" + pages + " (" + scanned + " so far)");
      const txs = await fetchPage(addr, key, before);
      if (!txs.length) break;
      for (const tx of txs) {
        scanned++;
        if (tx.source && tx.source !== "SYSTEM_PROGRAM" && tx.source !== "UNKNOWN") sources.add(tx.source);
        (tx.nativeTransfers || []).forEach((t) => {
          if (t.fromUserAccount === addr && t.toUserAccount && t.toUserAccount !== addr) {
            const amt = Number(t.amount) || 0;
            outSol.set(t.toUserAccount, (outSol.get(t.toUserAccount) || 0) + amt);
            outCount.set(t.toUserAccount, (outCount.get(t.toUserAccount) || 0) + 1);
            if (!outLast.has(t.toUserAccount) || (tx.timestamp || 0) > outLast.get(t.toUserAccount))
              outLast.set(t.toUserAccount, tx.timestamp || 0);
            totalOut += amt;
          } else if (t.toUserAccount === addr && t.fromUserAccount !== addr) {
            inSol += Number(t.amount) || 0;
          }
        });
        (tx.tokenTransfers || []).forEach((t) => {
          if (t.fromUserAccount === addr && t.toUserAccount && t.toUserAccount !== addr) {
            tokenOut.set(t.toUserAccount, (tokenOut.get(t.toUserAccount) || 0) + 1);
          }
        });
      }
      before = txs[txs.length - 1].signature;
      if (txs.length < 100) break;
    }

    render(addr, { outSol, outCount, outLast, tokenOut, inSol, totalOut, scanned, sources });
  } catch (e) {
    setStatus("Failed: " + (e.message || e), "err");
  } finally {
    loading = false;
    $("btn_track").disabled = false;
  }
}

function render(addr, d) {
  const rows = [...d.outSol.entries()]
    .map(([dest, lam]) => ({ dest, lam, count: d.outCount.get(dest) || 0, last: d.outLast.get(dest) || 0, tok: d.tokenOut.get(dest) || 0 }))
    .sort((a, b) => b.lam - a.lam);

  $("s_scanned").textContent = d.scanned;
  $("s_out").textContent = fmtSol(d.totalOut) + " SOL";
  $("s_in").textContent = fmtSol(d.inSol) + " SOL";
  $("s_dest").textContent = rows.length;

  const grid = $("list");
  grid.innerHTML = "";
  if (!rows.length) {
    grid.innerHTML = `<div class="empty">No outgoing SOL transfers found in the ${d.scanned} scanned transactions. Try scanning more pages, or this wallet mostly moved tokens.</div>`;
    setStatus("Done — no SOL outflows found.", "ok");
    return;
  }

  // heuristic: a destination hit many times with tiny average transfers is
  // almost always a trading-bot / fee wallet (bots take a small SOL fee per trade)
  const isBot = (r) => r.count >= 5 && (r.lam / r.count) < 0.05 * LAMPORTS_PER_SOL;
  rows.forEach((r) => { r.bot = isBot(r); });

  const top = rows[0];
  const topPct = d.totalOut ? (top.lam / d.totalOut * 100) : 0;
  const platforms = [...(d.sources || [])];
  const bots = rows.filter((r) => r.bot).sort((a, b) => b.count - a.count);

  let head = `Biggest destination: <a href="https://solscan.io/account/${top.dest}" target="_blank" rel="noopener">${shortAddr(top.dest)}</a> — ` +
    `<b>${fmtSol(top.lam)} SOL</b> (${topPct.toFixed(1)}% of all outgoing SOL).`;
  if (platforms.length) head += `<br><span class="tag-lbl">platforms used:</span> ${platforms.join(", ")}`;
  if (bots.length) {
    head += `<br><span class="tag-lbl">likely bot / fee wallets:</span> ` +
      bots.slice(0, 5).map((r) => `<a href="https://solscan.io/account/${r.dest}" target="_blank" rel="noopener">${shortAddr(r.dest)}</a> (${r.count}×)`).join(", ") +
      ` <span class="note">— recurring tiny fees, typical of BonkBot / Trojan / Photon / Maestro-style bots. Open on Solscan to identify.</span>`;
  }
  $("headline").innerHTML = head;

  const frag = document.createDocumentFragment();
  rows.slice(0, 60).forEach((r, i) => {
    const pct = d.totalOut ? (r.lam / d.totalOut * 100) : 0;
    const el = document.createElement("div");
    el.className = "dest";
    el.innerHTML = `
      <span class="d-rank">${i + 1}</span>
      <span class="d-addr">
        <a href="https://solscan.io/account/${r.dest}" target="_blank" rel="noopener">${shortAddr(r.dest)}</a>${r.bot ? ' <span class="botflag">⚙ bot/fee?</span>' : ""}
        <span class="d-meta">${r.count} tx${r.count > 1 ? "s" : ""}${r.tok ? " · " + r.tok + " token xfer" : ""} · last ${fmtDate(r.last)}</span>
        <span class="d-bar"><span style="width:${Math.max(2, pct).toFixed(1)}%"></span></span>
      </span>
      <span class="d-sol">${fmtSol(r.lam)} ◎<span class="d-pct">${pct.toFixed(1)}%</span></span>`;
    frag.appendChild(el);
  });
  grid.appendChild(frag);
  setStatus("Done — scanned " + d.scanned + " transactions." + (bots.length ? " " + bots.length + " likely bot/fee wallet(s) flagged." : ""), "ok");
}

window.addEventListener("DOMContentLoaded", () => {
  try { $("in_key").value = localStorage.getItem(KEY_LS) || ""; } catch (e) {}
  $("btn_track").addEventListener("click", track);
  $("in_addr").addEventListener("keydown", (e) => { if (e.key === "Enter") track(); });
});
