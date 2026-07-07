// solwrapper.js — wrap/unwrap SOL <-> wSOL via Phantom + base58 <-> byte-array wallet tools.
// 100% client-side. Private keys typed into the decoder never leave the browser.

// ── Solana program constants ───────────────────────────────────────────
const WSOL_MINT_STR = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_STR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOC_TOKEN_PROGRAM_STR = "ATokenGPvbdGVxr1b2xr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_STR = "11111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000;

const RPCS = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

// ── Base58 (self-contained, no CDN) ────────────────────────────────────
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(str) {
  const map = {};
  for (let i = 0; i < B58_ALPHABET.length; i++) map[B58_ALPHABET[i]] = i;
  const bytes = [0];
  for (const ch of str) {
    if (!(ch in map)) throw new Error("Invalid base58 character: '" + ch + "'");
    let carry = map[ch];
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function b58encode(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) str += "1";
  for (let q = digits.length - 1; q >= 0; q--) str += B58_ALPHABET[digits[q]];
  return str;
}

// ── DOM helpers ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function setWrapStatus(msg, cls) {
  const el = $("w_status");
  el.textContent = msg;
  el.className = cls || "";
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
}

// ── Wallet / connection state ──────────────────────────────────────────
let connection = null;
let walletAddr = null;

function currentRpc() {
  const custom = $("in_rpc").value.trim();
  if (custom) return custom;
  return RPCS[$("sel_net").value] || RPCS["mainnet-beta"];
}

function getConnection() {
  if (!connection) {
    connection = new window.solanaWeb3.Connection(currentRpc(), "confirmed");
  }
  return connection;
}

async function connectWallet() {
  if (!window.solana || !window.solana.isPhantom) {
    throw new Error("Phantom Wallet extension was not detected.");
  }
  const resp = await window.solana.connect();
  walletAddr = resp.publicKey.toString();
  $("s_wallet").textContent = walletAddr;
  $("btn_connect").textContent = "connected";
  return walletAddr;
}

// Rebuild the connection when the network / rpc changes.
function invalidateConnection() { connection = null; }

// ── Associated token account + instruction builders ────────────────────
function wsolAta(ownerPub) {
  const { PublicKey } = window.solanaWeb3;
  const [ata] = PublicKey.findProgramAddressSync(
    [
      ownerPub.toBuffer(),
      new PublicKey(TOKEN_PROGRAM_STR).toBuffer(),
      new PublicKey(WSOL_MINT_STR).toBuffer(),
    ],
    new PublicKey(ASSOC_TOKEN_PROGRAM_STR)
  );
  return ata;
}

function createAtaIdempotentIx(payer, ata, owner) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(WSOL_MINT_STR), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_STR), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_STR), isSigner: false, isWritable: false },
    ],
    programId: new PublicKey(ASSOC_TOKEN_PROGRAM_STR),
    data: new Uint8Array([1]), // 1 = CreateIdempotent
  });
}

function syncNativeIx(ata) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  return new TransactionInstruction({
    keys: [{ pubkey: ata, isSigner: false, isWritable: true }],
    programId: new PublicKey(TOKEN_PROGRAM_STR),
    data: new Uint8Array([17]), // 17 = SyncNative
  });
}

function closeAccountIx(account, dest, owner) {
  const { PublicKey, TransactionInstruction } = window.solanaWeb3;
  return new TransactionInstruction({
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: new PublicKey(TOKEN_PROGRAM_STR),
    data: new Uint8Array([9]), // 9 = CloseAccount
  });
}

async function sendTx(instructions, ownerPub) {
  const { Transaction } = window.solanaWeb3;
  const conn = getConnection();
  const tx = new Transaction();
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = ownerPub;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const { signature } = await window.solana.signAndSendTransaction(tx);
  setWrapStatus("Confirming " + signature.slice(0, 8) + "…", "");
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

// ── Balance display ────────────────────────────────────────────────────
async function refreshBalances() {
  if (!walletAddr) return;
  const { PublicKey } = window.solanaWeb3;
  const conn = getConnection();
  const owner = new PublicKey(walletAddr);
  try {
    const lamports = await conn.getBalance(owner, "confirmed");
    $("s_sol").textContent = (lamports / LAMPORTS_PER_SOL).toFixed(9) + " SOL";
  } catch (e) {
    $("s_sol").textContent = "error";
  }
  try {
    const ata = wsolAta(owner);
    $("s_ata").textContent = ata.toString();
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    $("s_wsol").textContent = (bal.value.uiAmount ?? 0) + " wSOL";
  } catch (e) {
    $("s_wsol").textContent = "0 wSOL (no account)";
  }
}

// ── Actions ────────────────────────────────────────────────────────────
async function doConnect() {
  try {
    setWrapStatus("Connecting to Phantom…", "");
    await connectWallet();
    setWrapStatus("Wallet connected.", "ok");
    await refreshBalances();
  } catch (e) {
    setWrapStatus(e.message, "err");
  }
}

async function doWrap() {
  try {
    if (!walletAddr) await connectWallet();
    const amount = parseFloat($("in_amount").value);
    if (!(amount > 0)) { setWrapStatus("Enter an amount of SOL > 0 to wrap.", "err"); return; }
    const lamports = Math.round(amount * LAMPORTS_PER_SOL);

    const { PublicKey, SystemProgram } = window.solanaWeb3;
    const owner = new PublicKey(walletAddr);
    const ata = wsolAta(owner);

    setWrapStatus("Wrapping " + amount + " SOL → wSOL…", "");
    const sig = await sendTx([
      createAtaIdempotentIx(owner, ata, owner),
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports }),
      syncNativeIx(ata),
    ], owner);
    setWrapStatus("Wrapped " + amount + " SOL. Tx: " + sig, "ok");
    await refreshBalances();
  } catch (e) {
    setWrapStatus("Wrap failed: " + (e.message || e), "err");
  }
}

async function doUnwrap() {
  try {
    if (!walletAddr) await connectWallet();
    const { PublicKey } = window.solanaWeb3;
    const owner = new PublicKey(walletAddr);
    const ata = wsolAta(owner);

    setWrapStatus("Unwrapping — closing wSOL account, returning SOL…", "");
    const sig = await sendTx([closeAccountIx(ata, owner, owner)], owner);
    setWrapStatus("Unwrapped. All wSOL + rent returned to your wallet. Tx: " + sig, "ok");
    await refreshBalances();
  } catch (e) {
    setWrapStatus("Unwrap failed: " + (e.message || e), "err");
  }
}

// ── Decoder: base58 secret key → byte array JSON ───────────────────────
function doDecode() {
  const out = $("dec_out");
  const info = $("dec_info");
  out.value = "";
  info.textContent = "";
  info.className = "hint";
  const raw = $("dec_in").value.trim();
  if (!raw) { info.textContent = "Paste a base58 private key first."; info.className = "hint err"; return; }
  try {
    const decoded = b58decode(raw);
    const json = "[" + Array.from(decoded).join(",") + "]";
    out.value = json;
    if (decoded.length !== 64) {
      info.textContent =
        "⚠ Decoded to " + decoded.length + " bytes (expected 64). " +
        "This may be a public address or a different value, not a full keypair.";
      info.className = "hint err";
    } else {
      const pub = b58encode(decoded.slice(32, 64));
      info.innerHTML = "✔ 64 bytes. Public key: <code>" + pub + "</code>";
      info.className = "hint ok";
    }
  } catch (e) {
    info.textContent = e.message;
    info.className = "hint err";
  }
}

// ── Encoder: byte array (or comma list) → base58 secret key ────────────
function doEncode() {
  const out = $("enc_out");
  const info = $("enc_info");
  out.value = "";
  info.textContent = "";
  info.className = "hint";
  const raw = $("enc_in").value.trim();
  if (!raw) { info.textContent = "Paste a byte array like [12,34,…] first."; info.className = "hint err"; return; }
  try {
    let arr;
    const cleaned = raw.replace(/^\s*\[/, "").replace(/\]\s*$/, "");
    arr = cleaned.split(",").map((s) => s.trim()).filter((s) => s.length).map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Invalid byte value: '" + s + "'");
      return n;
    });
    const bytes = new Uint8Array(arr);
    out.value = b58encode(bytes);
    if (bytes.length !== 64) {
      info.textContent = "⚠ " + bytes.length + " bytes (a keypair secret is normally 64).";
      info.className = "hint err";
    } else {
      const pub = b58encode(bytes.slice(32, 64));
      info.innerHTML = "✔ 64 bytes. Public key: <code>" + pub + "</code>";
      info.className = "hint ok";
    }
  } catch (e) {
    info.textContent = e.message;
    info.className = "hint err";
  }
}

function downloadJson() {
  const json = $("dec_out").value.trim();
  if (!json) { doDecode(); }
  const data = $("dec_out").value.trim();
  if (!data) return;
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "soltowsol.json";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Wire up ────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  $("btn_connect").addEventListener("click", doConnect);
  $("btn_wrap").addEventListener("click", doWrap);
  $("btn_unwrap").addEventListener("click", doUnwrap);
  $("btn_refresh").addEventListener("click", () => { refreshBalances(); });
  $("sel_net").addEventListener("change", () => { invalidateConnection(); refreshBalances(); });
  $("in_rpc").addEventListener("change", () => { invalidateConnection(); refreshBalances(); });

  $("btn_decode").addEventListener("click", doDecode);
  $("btn_dec_copy").addEventListener("click", () => copyText($("dec_out").value, $("btn_dec_copy")));
  $("btn_dec_dl").addEventListener("click", downloadJson);

  $("btn_encode").addEventListener("click", doEncode);
  $("btn_enc_copy").addEventListener("click", () => copyText($("enc_out").value, $("btn_enc_copy")));

  if (window.solana && window.solana.isPhantom) {
    window.solana.on && window.solana.on("disconnect", () => {
      walletAddr = null;
      $("s_wallet").textContent = "—";
      $("btn_connect").textContent = "connect Phantom";
    });
  }
});
