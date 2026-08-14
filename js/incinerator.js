// incinerator.js — reclaim SOL rent by closing your own empty token accounts,
// and optionally burn worthless spam tokens/NFTs. 100% client-side. Every
// instruction acts on YOUR wallet and returns the rent to YOU — no authority is
// ever delegated to anyone. Read every Phantom transaction before approving.

const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const LAMPORTS_PER_SOL = 1e9;
const RPCS = {
  "mainnet-beta": "https://solana-rpc.publicnode.com",
  devnet: "https://api.devnet.solana.com",
};

const $ = (id) => document.getElementById(id);
let connection = null;
let walletAddr = null;
let accounts = [];

// ── Connection / wallet ────────────────────────────────────────────────
function currentRpc() {
  const c = $("in_rpc").value.trim();
  return c || RPCS[$("sel_net").value] || RPCS["mainnet-beta"];
}
function getConnection() {
  if (!connection) connection = new window.solanaWeb3.Connection(currentRpc(), "confirmed");
  return connection;
}
function invalidateConnection() { connection = null; }

function setStatus(msg, cls) {
  if (window.hideLoader) window.hideLoader("status");
  const el = $("status");
  el.textContent = msg;
  el.className = cls || "";
}

async function connectWallet() {
  if (!window.solana || !window.solana.isPhantom) throw new Error("Phantom Wallet was not detected.");
  const r = await window.solana.connect();
  walletAddr = r.publicKey.toString();
  $("s_wallet").textContent = walletAddr;
  $("btn_connect").textContent = "connected";
  return walletAddr;
}

// ── Instruction builders (SPL Token) ───────────────────────────────────
function u64le(nStr) {
  let n = BigInt(nStr);
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(n & 0xffn); n >>= 8n; }
  return b;
}

function burnIx(account, mint, owner, amountRaw, pid) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  const data = new Uint8Array(9);
  data[0] = 8; // Burn
  data.set(u64le(amountRaw), 1);
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: new PublicKey(pid),
    data,
  });
}

function closeIx(account, owner, pid) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  return new TransactionInstruction({
    keys: [
      { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true }, // destination = you
      { pubkey: owner, isSigner: true, isWritable: false }, // authority
    ],
    programId: new PublicKey(pid),
    data: new Uint8Array([9]), // CloseAccount
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const RENT_TOKEN_ACCOUNT = 2039280; // lamports for a standard 165-byte SPL token account

// Helius DAS getTokenAccounts — lightweight, works on the free tier and returns
// every token account (both programs, incl. empty) paginated. Avoids the heavy
// getTokenAccountsByOwner / getProgramAccounts that public RPCs block.
async function fetchHelius(owner, url) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const body = JSON.stringify({
      jsonrpc: "2.0", id: "inc", method: "getTokenAccounts",
      params: { owner, page, limit: 1000, options: { showZeroBalance: true } },
    });
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) throw new Error("Helius HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "Helius error");
    const list = (j.result && j.result.token_accounts) || [];
    list.forEach((t) => out.push({
      pubkey: t.address,
      mint: t.mint,
      amountRaw: String(t.amount != null ? t.amount : "0"),
      decimals: 0,
      uiAmount: Number(t.amount) || 0,
      lamports: RENT_TOKEN_ACCOUNT,
      pid: t.token_program || TOKEN_PROGRAM,
    }));
    if (list.length < 1000) break;
  }
  return out;
}

// Standard path (works only on RPCs that allow getTokenAccountsByOwner).
async function fetchStandard(owner) {
  const { PublicKey } = window.solanaWeb3;
  const out = [];
  for (const pid of [TOKEN_PROGRAM, TOKEN_2022]) {
    const res = await getConnection().getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(pid) });
    res.value.forEach((v) => {
      const info = v.account.data.parsed.info;
      out.push({
        pubkey: v.pubkey.toString(),
        mint: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        uiAmount: info.tokenAmount.uiAmount || 0,
        lamports: v.account.lamports || 0,
        pid,
      });
    });
  }
  return out;
}

// ── Scan ───────────────────────────────────────────────────────────────
async function scan() {
  try {
    if (!walletAddr) await connectWallet();
    const { PublicKey } = window.solanaWeb3;
    const owner = new PublicKey(walletAddr);
    const url = currentRpc();
    if (window.showLoader) window.showLoader("status", "Scanning token accounts…"); else setStatus("Scanning your token accounts…");
    accounts = /helius/i.test(url) ? await fetchHelius(walletAddr, url) : await fetchStandard(owner);
    // never list the same token account twice (closing it twice fails)
    const seen = new Set();
    accounts = accounts.filter((a) => (seen.has(a.pubkey) ? false : seen.add(a.pubkey)));
    renderList();
    setStatus("Found " + accounts.length + " token account(s). Select and incinerate to reclaim rent.", "ok");
  } catch (e) {
    setStatus("Scan failed: " + (e.message || e) +
      " — public RPCs block token-account scans. Paste a free Helius RPC URL in custom rpc (it uses a lighter method that works).", "err");
  }
}

function shortMint(m) { return m.slice(0, 4) + "…" + m.slice(-4); }

function renderList() {
  const grid = $("list");
  grid.innerHTML = "";
  if (!accounts.length) {
    grid.innerHTML = `<div class="empty">No token accounts found on this wallet.</div>`;
    updateTotals();
    return;
  }
  // empty accounts first (safe reclaim), then ones holding a balance
  accounts.sort((a, b) => (BigInt(a.amountRaw) > 0n ? 1 : 0) - (BigInt(b.amountRaw) > 0n ? 1 : 0));
  const frag = document.createDocumentFragment();
  accounts.forEach((a) => {
    const empty = BigInt(a.amountRaw) === 0n;
    const isWsol = a.mint === WSOL;
    const row = document.createElement("label");
    row.className = "acc" + (empty ? "" : " hasbal");
    row.innerHTML = `
      <input type="checkbox" id="cb_${a.pubkey}" ${empty ? "checked" : ""}>
      <span class="acc-mint"><a href="https://solscan.io/token/${a.mint}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${shortMint(a.mint)}</a>${isWsol ? ' <span class="tag">wSOL</span>' : ""}</span>
      <span class="acc-bal">${empty ? '<span class="ok">empty</span>' : (a.uiAmount + (isWsol ? " (unwraps)" : " — will BURN"))}</span>
      <span class="acc-rent">+${(a.lamports / LAMPORTS_PER_SOL).toFixed(5)} ◎</span>`;
    row.querySelector("input").addEventListener("change", updateTotals);
    frag.appendChild(row);
  });
  grid.appendChild(frag);
  updateTotals();
}

function selectedAccounts() {
  return accounts.filter((a) => { const cb = $("cb_" + a.pubkey); return cb && cb.checked; });
}

function updateTotals() {
  const sel = selectedAccounts();
  const rent = sel.reduce((s, a) => s + a.lamports, 0) / LAMPORTS_PER_SOL;
  const burns = sel.filter((a) => a.mint !== WSOL && BigInt(a.amountRaw) > 0n).length;
  $("s_count").textContent = accounts.length;
  $("s_sel").textContent = sel.length;
  $("s_rent").textContent = "~" + rent.toFixed(5) + " SOL";
  $("btn_burn").disabled = !sel.length;
  $("btn_burn").textContent = burns
    ? `🔥 burn ${burns} + close ${sel.length} (reclaim ~${rent.toFixed(4)} ◎)`
    : `♻ close ${sel.length} & reclaim ~${rent.toFixed(4)} ◎`;
}

function setAll(checked, emptyOnly) {
  accounts.forEach((a) => {
    const cb = $("cb_" + a.pubkey);
    if (!cb) return;
    cb.checked = checked && (!emptyOnly || BigInt(a.amountRaw) === 0n);
  });
  updateTotals();
}

// ── Incinerate ─────────────────────────────────────────────────────────
async function incinerate() {
  try {
    const sel = selectedAccounts();
    if (!sel.length) { setStatus("Nothing selected.", "err"); return; }
    const willBurn = sel.filter((a) => a.mint !== WSOL && BigInt(a.amountRaw) > 0n);
    if (willBurn.length &&
      !confirm(willBurn.length + " selected token(s) still hold a balance and will be PERMANENTLY BURNED (destroyed). " +
        "Only do this for spam / worthless tokens. Continue?")) return;

    const { PublicKey, Transaction } = window.solanaWeb3;
    const conn = getConnection();
    const owner = new PublicKey(walletAddr);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");

    // Pack as many accounts per tx as fit under the 1232-byte limit — fewer
    // transactions means Phantom can actually simulate & show the safe preview
    // (multi-tx bundles fail simulation). We add instructions greedily and start
    // a new tx only when the serialized message would get too big.
    const MAX_MSG = 1100; // safe margin below the 1232 wire limit (minus signature)
    const ixsFor = (a) => {
      const out = [];
      if (a.mint !== WSOL && BigInt(a.amountRaw) > 0n) out.push(burnIx(a.pubkey, a.mint, owner, a.amountRaw, a.pid));
      out.push(closeIx(a.pubkey, owner, a.pid));
      return out;
    };
    const mkTx = (ixs) => { const tx = new Transaction(); ixs.forEach((x) => tx.add(x)); tx.feePayer = owner; tx.recentBlockhash = blockhash; return tx; };
    const msgLen = (ixs) => { try { return mkTx(ixs).serializeMessage().length; } catch (e) { return 1e9; } };

    const txs = [];
    let cur = [];
    for (const a of sel) {
      const next = cur.concat(ixsFor(a));
      if (cur.length && msgLen(next) > MAX_MSG) { txs.push(mkTx(cur)); cur = ixsFor(a); }
      else cur = next;
    }
    if (cur.length) txs.push(mkTx(cur));

    setStatus("Approve in Phantom — " + txs.length + " transaction(s)…");
    const signed = await window.solana.signAllTransactions(txs);
    let ok = 0, pending = 0, errored = 0;
    for (let i = 0; i < signed.length; i++) {
      const sig = await conn.sendRawTransaction(signed[i].serialize());
      setStatus("Sent " + (i + 1) + "/" + signed.length + " (" + sig.slice(0, 8) + "…) — confirming…");
      const res = await pollConfirm(sig);
      if (res.state === "ok") ok++;
      else if (res.state === "err") errored++;
      else pending++;
    }
    const rent = sel.reduce((s, a) => s + a.lamports, 0) / LAMPORTS_PER_SOL;
    if (errored) {
      setStatus("Done with errors: " + ok + " ok, " + errored + " failed. Re-scan to see what remains.", "err");
    } else if (pending) {
      setStatus("Submitted — still confirming (slow RPC). Your balance will update; re-scan in a moment. Reclaiming ~" + rent.toFixed(5) + " SOL.", "");
    } else {
      setStatus("✔ Closed " + sel.length + " account(s) · reclaimed ~" + rent.toFixed(5) + " SOL back to your wallet.", "ok");
    }
    await scan();
  } catch (e) {
    setStatus("Failed: " + (e.message || e), "err");
  }
}

// Poll signature status instead of confirmTransaction (which throws
// "block height exceeded" on slow public RPCs even when the tx landed).
async function pollConfirm(signature, timeoutMs = 45000) {
  const conn = getConnection();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const st = res && res.value && res.value[0];
      if (st) {
        if (st.err) return { state: "err", err: st.err };
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { state: "ok" };
      }
    } catch (e) { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { state: "pending" };
}

// ── Wire up ────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  $("btn_connect").addEventListener("click", async () => {
    try { await connectWallet(); setStatus("Wallet connected. Scanning…", "ok"); await scan(); }
    catch (e) { setStatus(e.message, "err"); }
  });
  $("btn_scan").addEventListener("click", scan);
  $("btn_burn").addEventListener("click", incinerate);
  $("btn_empty").addEventListener("click", () => setAll(true, true));
  $("btn_allsel").addEventListener("click", () => setAll(true, false));
  $("btn_none").addEventListener("click", () => setAll(false, false));
  $("sel_net").addEventListener("change", invalidateConnection);
  $("in_rpc").addEventListener("change", invalidateConnection);
});
