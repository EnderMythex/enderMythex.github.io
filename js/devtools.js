// devtools.js — small Solana utilities: message sign/verify, .sol (SNS)
// resolver, ATA / PDA finder, rent calculator. Client-side.
const NAME_PROGRAM = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";
const SOL_TLD = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOC_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";

const $ = (id) => document.getElementById(id);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(str) {
  const map = {}; for (let i = 0; i < B58.length; i++) map[B58[i]] = i;
  const bytes = [0];
  for (const ch of str) {
    if (!(ch in map)) throw new Error("bad base58 char '" + ch + "'");
    let carry = map[ch];
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}
function b58encode(bytes) {
  const d = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < d.length; j++) { carry += d[j] << 8; d[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { d.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let s = ""; for (let k = 0; k < bytes.length && bytes[k] === 0; k++) s += "1";
  for (let q = d.length - 1; q >= 0; q--) s += B58[d[q]];
  return s;
}
function out(id, msg, ok) { const e = $(id); e.textContent = msg; e.className = "out " + (ok === true ? "ok" : ok === false ? "err" : ""); }

// ── Message sign / verify ───────────────────────────────────────────────
async function signMsg() {
  try {
    if (!window.solana || !window.solana.isPhantom) throw new Error("Phantom not detected.");
    await window.solana.connect();
    const msg = $("ms_msg").value;
    const enc = new TextEncoder().encode(msg);
    const res = await window.solana.signMessage(enc, "utf8");
    const sig = b58encode(res.signature);
    const pk = res.publicKey ? res.publicKey.toString() : window.solana.publicKey.toString();
    out("ms_out", "signature: " + sig + "\npublic key: " + pk, true);
  } catch (e) { out("ms_out", e.message || e, false); }
}
function verifyMsg() {
  try {
    const msg = new TextEncoder().encode($("mv_msg").value);
    const sig = b58decode($("mv_sig").value.trim());
    const pk = b58decode($("mv_pk").value.trim());
    if (pk.length !== 32) throw new Error("public key must be 32 bytes");
    const ok = window.nacl.sign.detached.verify(msg, sig, pk);
    out("mv_out", ok ? "VALID — this wallet signed this exact message." : "INVALID — signature does not match.", ok);
  } catch (e) { out("mv_out", e.message || e, false); }
}

// ── SNS (.sol) resolver ─────────────────────────────────────────────────
async function getHashedName(name) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("SPL Name Service" + name));
  return new Uint8Array(buf);
}
async function resolveSns() {
  try {
    const { PublicKey, Connection } = window.solanaWeb3;
    const domain = $("sns_in").value.trim().replace(/\.sol$/i, "").toLowerCase();
    if (!domain) throw new Error("Enter a .sol domain");
    const hashed = await getHashedName(domain);
    const [key] = PublicKey.findProgramAddressSync(
      [hashed, PublicKey.default.toBuffer(), new PublicKey(SOL_TLD).toBuffer()],
      new PublicKey(NAME_PROGRAM));
    const rpc = $("sns_rpc").value.trim() || DEFAULT_RPC;
    const conn = new Connection(rpc, "confirmed");
    const acc = await conn.getAccountInfo(key);
    if (!acc) throw new Error("domain not found / not registered");
    const owner = new PublicKey(acc.data.slice(32, 64)).toString();
    out("sns_out", domain + ".sol → " + owner + "\n(registry account: " + key.toString() + ")", true);
  } catch (e) { out("sns_out", e.message || e, false); }
}

// ── ATA finder ──────────────────────────────────────────────────────────
function findAta() {
  try {
    const { PublicKey } = window.solanaWeb3;
    const owner = new PublicKey($("ata_owner").value.trim());
    const mint = new PublicKey($("ata_mint").value.trim());
    const [k] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), mint.toBuffer()],
      new PublicKey(ASSOC_TOKEN_PROGRAM));
    out("ata_out", "associated token account:\n" + k.toString(), true);
  } catch (e) { out("ata_out", e.message || e, false); }
}

// ── PDA finder ──────────────────────────────────────────────────────────
function findPda() {
  try {
    const { PublicKey } = window.solanaWeb3;
    const prog = new PublicKey($("pda_prog").value.trim());
    const seeds = $("pda_seeds").value.split("\n").map((s) => s.trim()).filter((s) => s.length).map((s) => {
      if (/^pk:/.test(s)) return new PublicKey(s.slice(3).trim()).toBuffer();
      return new TextEncoder().encode(s);
    });
    const [k, bump] = PublicKey.findProgramAddressSync(seeds, prog);
    out("pda_out", "PDA: " + k.toString() + "\nbump: " + bump, true);
  } catch (e) { out("pda_out", e.message || e, false); }
}

// ── Rent calculator ─────────────────────────────────────────────────────
function calcRent() {
  const bytes = Number($("rent_bytes").value) || 0;
  const lamports = (128 + bytes) * 3480 * 2; // account overhead + data, 2y exemption
  out("rent_out", (lamports / 1e9).toFixed(9) + " SOL rent-exempt minimum (" + lamports.toLocaleString() + " lamports) for a " + bytes + "-byte account", true);
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn_sign").addEventListener("click", signMsg);
  $("btn_verify").addEventListener("click", verifyMsg);
  $("btn_sns").addEventListener("click", resolveSns);
  $("btn_ata").addEventListener("click", findAta);
  $("btn_pda").addEventListener("click", findPda);
  $("btn_rent").addEventListener("click", calcRent);
});
