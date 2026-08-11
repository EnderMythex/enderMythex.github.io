// multisender.js — send SOL or an SPL token to many addresses at once, in
// batched transactions signed via Phantom (signAllTransactions). 100% client-side.
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOC_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1e9;
const RPCS = { "mainnet-beta": "https://solana-rpc.publicnode.com", devnet: "https://api.devnet.solana.com" };

const $ = (id) => document.getElementById(id);
let connection = null, walletAddr = null;

function currentRpc() { const c = $("in_rpc").value.trim(); return c || RPCS[$("sel_net").value] || RPCS["mainnet-beta"]; }
function getConn() { if (!connection) connection = new window.solanaWeb3.Connection(currentRpc(), "confirmed"); return connection; }
function setStatus(m, c) { if (window.hideLoader) window.hideLoader("status"); const e = $("status"); e.textContent = m; e.className = c || ""; }

async function connectWallet() {
  if (!window.solana || !window.solana.isPhantom) throw new Error("Phantom not detected.");
  const r = await window.solana.connect();
  walletAddr = r.publicKey.toString();
  $("s_wallet").textContent = walletAddr;
  $("btn_connect").textContent = "connected";
}

function u64le(nStr) { let n = BigInt(nStr); const b = new Uint8Array(8); for (let i = 0; i < 8; i++) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; }
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

function ata(owner, mint) {
  const { PublicKey } = window.solanaWeb3;
  const [k] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), mint.toBuffer()],
    new PublicKey(ASSOC_TOKEN_PROGRAM));
  return k;
}
function createAtaIdemIx(payer, at, owner, mint) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: at, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ],
    programId: new PublicKey(ASSOC_TOKEN_PROGRAM), data: new Uint8Array([1]),
  });
}
function transferCheckedIx(source, mint, dest, owner, rawAmount, decimals) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  const data = new Uint8Array(10);
  data[0] = 12; data.set(u64le(rawAmount), 1); data[9] = decimals;
  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: new PublicKey(TOKEN_PROGRAM), data,
  });
}

function parseCsv() {
  const lines = $("in_csv").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [], bad = [];
  for (const l of lines) {
    const parts = l.split(/[,\s]+/).filter(Boolean);
    const addr = parts[0], amount = parseFloat(parts[1]);
    if (!addr || addr.length < 32 || !(amount > 0)) { bad.push(l); continue; }
    out.push({ addr, amount });
  }
  return { out, bad };
}

async function pollConfirm(sig, blockhash, lastValidBlockHeight) {
  const conn = getConn();
  const start = Date.now();
  while (Date.now() - start < 45000) {
    try {
      const s = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (s) { if (s.err) return "err"; if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") return "ok"; }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "pending";
}

function preview() {
  const { out, bad } = parseCsv();
  const total = out.reduce((s, r) => s + r.amount, 0);
  const asset = $("sel_asset").value === "sol" ? "SOL" : "tokens";
  setStatus(`${out.length} valid recipient(s), total ${total.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset}` +
    (bad.length ? ` · ${bad.length} invalid line(s) skipped` : ""), out.length ? "ok" : "err");
  return { out, total };
}

async function send() {
  try {
    if (!walletAddr) await connectWallet();
    const { PublicKey, Transaction, SystemProgram } = window.solanaWeb3;
    const owner = new PublicKey(walletAddr);
    const { out } = parseCsv();
    if (!out.length) { setStatus("No valid recipients.", "err"); return; }
    const isSol = $("sel_asset").value === "sol";

    let decimals = 9, mintPk = null, ownerAta = null;
    if (!isSol) {
      const mint = $("in_mint").value.trim();
      if (!mint) { setStatus("Enter the token mint address.", "err"); return; }
      mintPk = new PublicKey(mint);
      decimals = (await getConn().getTokenSupply(mintPk)).value.decimals;
      ownerAta = ata(owner, mintPk);
    }

    const total = out.reduce((s, r) => s + r.amount, 0);
    if (!confirm(`Send ${total} ${isSol ? "SOL" : "tokens"} to ${out.length} recipients? This is real and irreversible.`)) return;

    const per = isSol ? 12 : 5;
    const groups = chunk(out, per);
    const { blockhash, lastValidBlockHeight } = await getConn().getLatestBlockhash("confirmed");
    const txs = groups.map((g) => {
      const tx = new Transaction();
      g.forEach((r) => {
        const dest = new PublicKey(r.addr);
        if (isSol) {
          tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: dest, lamports: Math.round(r.amount * LAMPORTS_PER_SOL) }));
        } else {
          const destAta = ata(dest, mintPk);
          tx.add(createAtaIdemIx(owner, destAta, dest, mintPk));
          const raw = BigInt(Math.round(r.amount * Math.pow(10, decimals)));
          tx.add(transferCheckedIx(ownerAta, mintPk, destAta, owner, raw.toString(), decimals));
        }
      });
      tx.feePayer = owner; tx.recentBlockhash = blockhash;
      return tx;
    });

    const ld = window.showLoader ? window.showLoader("status", "Approve in Phantom — " + txs.length + " tx…") : null;
    const signed = await window.solana.signAllTransactions(txs);
    let ok = 0, pending = 0, err = 0;
    for (let i = 0; i < signed.length; i++) {
      const sig = await getConn().sendRawTransaction(signed[i].serialize());
      if (ld) ld.setLabel("Sending " + (i + 1) + "/" + signed.length + "…"); else setStatus("Sent " + (i + 1) + "/" + signed.length + "…");
      const st = await pollConfirm(sig, blockhash, lastValidBlockHeight);
      if (st === "ok") ok++; else if (st === "err") err++; else pending++;
    }
    setStatus(`Done — ${ok} confirmed${pending ? ", " + pending + " still pending" : ""}${err ? ", " + err + " failed" : ""}.`,
      err ? "err" : "ok");
  } catch (e) {
    setStatus("Failed: " + (e.message || e), "err");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn_connect").addEventListener("click", async () => { try { await connectWallet(); setStatus("Connected.", "ok"); } catch (e) { setStatus(e.message, "err"); } });
  $("btn_preview").addEventListener("click", preview);
  $("btn_send").addEventListener("click", send);
  $("sel_net").addEventListener("change", () => { connection = null; });
  $("in_rpc").addEventListener("change", () => { connection = null; });
  $("sel_asset").addEventListener("change", () => {
    $("mint_row").style.display = $("sel_asset").value === "token" ? "" : "none";
  });
});
