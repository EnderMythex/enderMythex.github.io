/* js/vanity.js */
"use strict";

const $ = id => document.getElementById(id);
const setStatus = (msg, cls="") => {
  const el=$("s_status"); el.textContent=msg;
  const wrap=$("status"); if(wrap){ wrap.textContent=""; wrap.className=cls; }
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_SET = new Set(B58);

// ── GPU + CPU detection ────────────────────────────────────────────────
function webglRendererName() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return gl.getParameter(gl.RENDERER) || null;
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null;
  } catch { return null; }
}
async function detectGPU() {
  const wgl = webglRendererName();
  let wgpu = null;
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter) {
        if (adapter.info) {
          const i = adapter.info;
          wgpu = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(" / ");
        } else if (adapter.requestAdapterInfo) {
          const i = await adapter.requestAdapterInfo();
          wgpu = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(" / ");
        }
      }
    } catch {}
  }
  $("s_gpu").textContent = (wgl || wgpu || "(not detected)") + "  ·  unused for Solana vanity";
  $("s_cpu").textContent = (navigator.hardwareConcurrency || "?") + " logical threads";
}

// ── Filter validation ──────────────────────────────────────────────────
function validateAffix(s, caseMode) {
  if (s === "") return null;
  for (const ch of s) {
    if (!B58_SET.has(ch)) return "invalid char '" + ch + "' (not in base58 alphabet)";
  }
  if (caseMode === "upper") {
    for (const ch of s) if (/[a-z]/.test(ch)) return "case=UPPER but '" + ch + "' is lowercase";
  } else if (caseMode === "lower") {
    for (const ch of s) if (/[A-Z]/.test(ch)) return "case=lower but '" + ch + "' is uppercase";
  }
  return null;
}

function refreshValidation() {
  const caseMode = $("sel_case").value;
  const pref = $("in_prefix").value;
  const suff = $("in_suffix").value;
  const ePref = validateAffix(pref, caseMode);
  const eSuff = validateAffix(suff, caseMode);
  $("in_prefix").classList.toggle("bad", !!ePref);
  $("in_suffix").classList.toggle("bad", !!eSuff);
  if (ePref) { setStatus("prefix: " + ePref, "err"); return false; }
  if (eSuff) { setStatus("suffix: " + eSuff, "err"); return false; }
  let logp = 0;
  const counts = (str) => {
    let n = 0;
    for (const ch of str) {
      if (caseMode === "ignore" && /[A-Za-z]/.test(ch)) logp += Math.log(2/58);
      else                                              logp += Math.log(1/58);
      n++;
    }
    return n;
  };
  const total = counts(pref) + counts(suff);
  if (total === 0) { $("s_expect").textContent = "—"; $("s_etime").textContent = "—"; return true; }
  const expectedTries = Math.exp(-logp);
  $("s_expect").textContent = expectedTries.toExponential(2) + " (≈ mean)";
  if (lastRate > 0) {
    const sec = expectedTries / lastRate;
    $("s_etime").textContent = humanTime(sec);
  } else {
    $("s_etime").textContent = "(start to measure)";
  }
  return true;
}

function humanTime(sec) {
  if (!isFinite(sec)) return "∞";
  if (sec < 60) return sec.toFixed(1) + " s";
  if (sec < 3600) return (sec/60).toFixed(1) + " min";
  if (sec < 86400) return (sec/3600).toFixed(1) + " h";
  if (sec < 86400*365) return (sec/86400).toFixed(1) + " d";
  return (sec/86400/365).toFixed(2) + " y";
}

// ── Worker source ──────────────────────────────────────────────────────
const WORKER_SRC = String.raw`
self.importScripts("https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/nacl.min.js");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Uint8Array(128);
for (let i = 0; i < 128; i++) B58_MAP[i] = 255;
for (let i = 0; i < B58.length; i++) B58_MAP[B58.charCodeAt(i)] = i;

function encodeB58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = ((bytes.length - zeros) * 138 / 100 + 1) | 0;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = size - length;
  while (it < size && b58[it] === 0) it++;
  let str = "1".repeat(zeros);
  for (; it < size; it++) str += B58[b58[it]];
  return str;
}

let stop = false;
let prefix = "", suffix = "", caseMode = "exact";
let stopAfter = 1, foundCount = 0;
let myIdx = 0, total = 1;
let sampleEvery = 500;
let nearMissOnly = true;

function matches(addr) {
  let p = prefix, s = suffix, a = addr;
  if (caseMode === "ignore" || caseMode === "upper" || caseMode === "lower") {
    a = addr.toLowerCase(); p = prefix.toLowerCase(); s = suffix.toLowerCase();
  }
  if (p && !a.startsWith(p)) return false;
  if (s && !a.endsWith(s))   return false;
  if (caseMode === "upper") {
    for (let i = 0; i < prefix.length; i++) if (/[a-z]/.test(addr[i])) return false;
    for (let i = 0; i < suffix.length; i++) if (/[a-z]/.test(addr[addr.length - suffix.length + i])) return false;
  } else if (caseMode === "lower") {
    for (let i = 0; i < prefix.length; i++) if (/[A-Z]/.test(addr[i])) return false;
    for (let i = 0; i < suffix.length; i++) if (/[A-Z]/.test(addr[addr.length - suffix.length + i])) return false;
  }
  return true;
}

function prefixMatchLen(addr) {
  if (!prefix) return 0;
  let a = addr, p = prefix;
  if (caseMode === "ignore" || caseMode === "upper" || caseMode === "lower") { a = addr.toLowerCase(); p = prefix.toLowerCase(); }
  let n = 0; const lim = Math.min(a.length, p.length);
  for (; n < lim; n++) if (a[n] !== p[n]) break;
  return n;
}
function suffixMatchLen(addr) {
  if (!suffix) return 0;
  let a = addr, s = suffix;
  if (caseMode === "ignore" || caseMode === "upper" || caseMode === "lower") { a = addr.toLowerCase(); s = suffix.toLowerCase(); }
  let n = 0; const lim = Math.min(a.length, s.length);
  for (; n < lim; n++) if (a[a.length-1-n] !== s[s.length-1-n]) break;
  return n;
}

function run() {
  const REPORT_EVERY = 300;
  let local = 0;
  let triesSinceSample = 0;
  let last = performance.now();
  let bestPLen = -1, bestSLen = -1, bestAddr = "";
  while (!stop) {
    const kp = self.nacl.sign.keyPair();
    const addr = encodeB58(kp.publicKey);
    const pLen = prefixMatchLen(addr);
    const sLen = suffixMatchLen(addr);
    if (pLen + sLen > bestPLen + bestSLen) { bestPLen = pLen; bestSLen = sLen; bestAddr = addr; }

    if (matches(addr)) {
      const skB58 = encodeB58(kp.secretKey);
      self.postMessage({ type: "found", address: addr, secretKey: skB58, secretBytes: Array.from(kp.secretKey) });
      foundCount++;
      if (foundCount >= stopAfter) { stop = true; break; }
    }

    local++;
    triesSinceSample++;
    if (triesSinceSample >= sampleEvery) {
      const interesting = (bestPLen > 0 || bestSLen > 0);
      if (!nearMissOnly || interesting) {
        self.postMessage({
          type: "sample",
          addr: bestAddr || addr,
          pLen: bestPLen >= 0 ? bestPLen : 0,
          sLen: bestSLen >= 0 ? bestSLen : 0,
          pTotal: prefix.length,
          sTotal: suffix.length,
        });
      }
      triesSinceSample = 0;
      bestPLen = -1; bestSLen = -1; bestAddr = "";
    }
    if (local >= REPORT_EVERY) {
      const now = performance.now();
      self.postMessage({ type: "progress", tries: local, dt: now - last });
      local = 0;
      last = now;
    }
  }
  if (local > 0) self.postMessage({ type: "progress", tries: local, dt: performance.now() - last });
  self.postMessage({ type: "done" });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") { myIdx = m.idx; total = m.total; }
  else if (m.type === "params") {
    prefix = m.prefix; suffix = m.suffix; caseMode = m.caseMode;
    stopAfter = m.stopAfter | 0; foundCount = 0;
    sampleEvery = Math.max(1, m.sampleEvery | 0);
    nearMissOnly = !!m.nearMissOnly;
  }
  else if (m.type === "start") { stop = false; run(); }
  else if (m.type === "stop")  { stop = true; }
};
`;

// ── App state ──────────────────────────────────────────────────────────
let workers = [];
let running = false;
let triesAcc = 0n;
let foundAcc = 0;
let rateSamples = [];
let lastRate = 0;
let stopAfter = 1;

function effectiveThreadCount() {
  const want = parseInt($("in_threads").value, 10);
  if (Number.isFinite(want) && want > 0) return Math.min(want, 64);
  return Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
}

function fmt(n) {
  n = Number(n);
  const u = ["", "k", "M", "G"];
  let i = 0; while (n >= 1000 && i < u.length-1) { n /= 1000; i++; }
  return n.toFixed(2) + " " + u[i];
}

function updateUI() {
  $("s_tries").textContent = triesAcc.toLocaleString("en-US");
  const now = performance.now();
  while (rateSamples.length > 0 && now - rateSamples[0].t > 10000) rateSamples.shift();
  const sum = rateSamples.reduce((s,x)=>s+x.h, 0);
  const dt  = (now - (rateSamples[0]?.t ?? now)) / 1000;
  lastRate  = dt > 0 ? sum / dt : 0;
  $("s_rate").textContent = lastRate ? fmt(lastRate) + " addr/s · " + workers.length + " threads" : "—";
  $("s_found").textContent = String(foundAcc);
  refreshValidation();
}

const LOG_MAX = 200;
function appendLog(s) {
  const log = $("log");
  const t = new Date();
  const hh = String(t.getHours()).padStart(2,"0");
  const mm = String(t.getMinutes()).padStart(2,"0");
  const ss = String(t.getSeconds()).padStart(2,"0");
  const total = (s.pTotal || 0) + (s.sTotal || 0);
  const matched = (s.pLen || 0) + (s.sLen || 0);
  const isHit = total > 0 && matched === total;
  const cls = isHit ? "hit" : (matched > 0 ? "near" : "miss");
  let label = "";
  if (s.pTotal) label += "prefix " + (s.pLen || 0) + "/" + s.pTotal;
  if (s.sTotal) label += (label ? " · " : "") + "suffix " + (s.sLen || 0) + "/" + s.sTotal;
  if (!label) label = "sample";

  const addr = s.addr || "";
  const pL = s.pLen || 0;
  const sL = s.sLen || 0;
  const head = addr.slice(0, pL);
  const tail = sL > 0 ? addr.slice(-sL) : "";
  const mid  = addr.slice(pL, addr.length - sL);
  const addrHtml =
    (pL ? '<span class="' + cls + '">' + escapeHtml(head) + '</span>' : "") +
    '<span class="miss">' + escapeHtml(mid) + '</span>' +
    (sL ? '<span class="' + cls + '">' + escapeHtml(tail) + '</span>' : "");

  const line = document.createElement("div");
  line.innerHTML =
    '<span class="ts">' + hh + ':' + mm + ':' + ss + '</span>' +
    '<span class="adr">' + addrHtml + '</span> ' +
    '<span class="' + cls + '">[' + label + ']</span>';
  log.insertBefore(line, log.firstChild);
  while (log.childNodes.length > LOG_MAX) log.removeChild(log.lastChild);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

function appendResult({ address, secretKey, secretBytes }) {
  showQrModal(address, secretKey, secretBytes);
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML =
    '<div class="addr">' + address + ' <button class="copy" data-copy="' + address + '">copy</button></div>' +
    '<div class="priv">private key (base58): ' + secretKey + ' <button class="copy" data-copy="' + secretKey + '">copy</button> <button class="qr-btn" data-addr="' + address + '" data-key="' + secretKey + '" data-bytes=\'' + JSON.stringify(secretBytes) + '\'>QR</button></div>' +
    '<div class="meta">found after ' + triesAcc.toLocaleString("en-US") + ' tries</div>';
  const results = $("results");
  results.insertBefore(div, results.firstChild);
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("copy")) {
    navigator.clipboard.writeText(t.dataset.copy).then(() => {
      const old = t.textContent;
      t.textContent = "copied";
      setTimeout(() => t.textContent = old, 1200);
    });
  }
  if (t.classList && t.classList.contains("qr-btn")) {
    showQrModal(t.dataset.addr, t.dataset.key, JSON.parse(t.dataset.bytes));
  }
});

// ── Engine ─────────────────────────────────────────────────────────────
function startGen() {
  if (running) return;
  if (!refreshValidation()) return;
  const prefix = $("in_prefix").value;
  const suffix = $("in_suffix").value;
  const caseMode = $("sel_case").value;
  if (!prefix && !suffix) { setStatus("Enter at least a prefix or a suffix.", "warn"); return; }
  stopAfter = Math.max(1, parseInt($("in_stopafter").value, 10) || 1);

  triesAcc = 0n; foundAcc = 0; rateSamples = [];
  $("s_tries").textContent = "0"; $("s_found").textContent = "0";

  const N = effectiveThreadCount();
  const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  workers = [];
  for (let i = 0; i < N; i++) {
    const w = new Worker(url);
    w.postMessage({ type: "init", idx: i, total: N });
    w.postMessage({
      type: "params", prefix, suffix, caseMode, stopAfter,
      sampleEvery: Math.max(1, parseInt($("in_log_rate").value, 10) || 500),
      nearMissOnly: $("cb_log_near").checked,
    });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        triesAcc += BigInt(m.tries);
        rateSamples.push({ t: performance.now(), h: m.tries });
      } else if (m.type === "sample") {
        appendLog(m);
      } else if (m.type === "found") {
        foundAcc++;
        appendResult(m);
        if (foundAcc >= stopAfter) {
          for (const w2 of workers) { try { w2.terminate(); } catch {} }
          workers = [];
          running = false;
          $("btn_start").disabled = false;
          $("btn_stop").disabled = true;
          setStatus("✓ " + foundAcc + " match(es) found — stopped.");
        }
      }
    };
    w.postMessage({ type: "start" });
    workers.push(w);
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  running = true;
  $("btn_start").disabled = true;
  $("btn_stop").disabled = false;
  setStatus("searching · " + N + " threads · prefix='" + prefix + "' suffix='" + suffix + "' case=" + caseMode);
}

function stopGen() {
  for (const w of workers) { try { w.postMessage({ type: "stop" }); w.terminate(); } catch {} }
  workers = [];
  running = false;
  $("btn_start").disabled = false;
  $("btn_stop").disabled = true;
  setStatus("⏹ stopped.");
}

// ── Wire UI ────────────────────────────────────────────────────────────
$("btn_start").onclick = startGen;
$("btn_stop").onclick  = stopGen;
$("btn_clear").onclick = () => { $("results").innerHTML = ""; foundAcc = 0; $("s_found").textContent = "0"; };
$("btn_log_clear").onclick = () => { $("log").innerHTML = ""; };

function broadcastLogPrefs() {
  if (!running) return;
  const params = {
    type: "params",
    prefix: $("in_prefix").value,
    suffix: $("in_suffix").value,
    caseMode: $("sel_case").value,
    stopAfter,
    sampleEvery: Math.max(1, parseInt($("in_log_rate").value, 10) || 500),
    nearMissOnly: $("cb_log_near").checked,
  };
  for (const w of workers) w.postMessage(params);
}
$("in_log_rate").addEventListener("change", broadcastLogPrefs);
$("cb_log_near").addEventListener("change", broadcastLogPrefs);

["in_prefix","in_suffix","sel_case"].forEach(id => {
  $(id).addEventListener("input",  refreshValidation);
  $(id).addEventListener("change", refreshValidation);
});

setInterval(updateUI, 300);

// ── Boot ───────────────────────────────────────────────────────────────
(async function boot() {
  await detectGPU();
  refreshValidation();
  setStatus("Ready. Set a prefix/suffix then ▶ start.");
})();

// ── QR modal ───────────────────────────────────────────────────────────
let _qrCurrentKey = "";
let _qrCurrentBytes = [];

function showQrModal(address, secretKey, secretBytes) {
  _qrCurrentKey   = secretKey;
  _qrCurrentBytes = secretBytes;
  $("qr-addr").textContent = address;
  $("qr-key").textContent  = secretKey;
  const wrap = $("qr-canvas-wrap");
  wrap.innerHTML = "";
  new QRCode(wrap, {
    text: secretKey,
    width: 220, height: 220,
    colorDark: "#000000", colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
  $("qr-overlay").classList.add("open");
}

$("qr-close").onclick = () => $("qr-overlay").classList.remove("open");
$("qr-overlay").addEventListener("click", e => {
  if (e.target === $("qr-overlay")) $("qr-overlay").classList.remove("open");
});
$("qr-copy").onclick = () => {
  navigator.clipboard.writeText(_qrCurrentKey).then(() => {
    const btn = $("qr-copy");
    const old = btn.textContent;
    btn.textContent = "copied!";
    setTimeout(() => btn.textContent = old, 1400);
  });
};
$("qr-dl").onclick = () => {
  const blob = new Blob([JSON.stringify(_qrCurrentBytes)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "keypair.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

window.addEventListener("beforeunload", stopGen);
