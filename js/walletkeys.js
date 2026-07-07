// walletkeys.js — base58 <-> byte-array (Solana keyfile) converter.
// 100% client-side. Keys typed here never leave the browser.

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

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
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
    out.value = "[" + Array.from(decoded).join(",") + "]";
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
    const cleaned = raw.replace(/^\s*\[/, "").replace(/\]\s*$/, "");
    const arr = cleaned.split(",").map((s) => s.trim()).filter((s) => s.length).map((s) => {
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
  if (!$("dec_out").value.trim()) doDecode();
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
  $("btn_decode").addEventListener("click", doDecode);
  $("btn_dec_copy").addEventListener("click", () => copyText($("dec_out").value, $("btn_dec_copy")));
  $("btn_dec_dl").addEventListener("click", downloadJson);

  $("btn_encode").addEventListener("click", doEncode);
  $("btn_enc_copy").addEventListener("click", () => copyText($("enc_out").value, $("btn_enc_copy")));
});
