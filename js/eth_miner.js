/* js/miner.js */
"use strict";

const PAYOUT_TARGET = "0xB5Da12E6Ce8DBdA0c8390DB46958F61181C6E381".toLowerCase();
const CONTRACT      = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";
const CHAIN_ID      = 1n;
const ABI = [
  "function getChallenge(address) view returns (bytes32)",
  "function miningState() view returns (uint256,uint256,uint256,uint256,bytes32,uint64,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function mine(uint256 nonce)"
];

const $ = id => document.getElementById(id);
const setStatus = (msg, cls="") => { const el=$("status"); el.textContent=msg; el.className=cls; };

const SHADER = String.raw`
// ── Constants ─────────────────────────────────────────────────────────
const ITERATIONS: u32 = 16u;

const RC: array<vec2<u32>, 24> = array<vec2<u32>, 24>(
  vec2<u32>(0x00000001u, 0x00000000u),
  vec2<u32>(0x00008082u, 0x00000000u),
  vec2<u32>(0x0000808au, 0x80000000u),
  vec2<u32>(0x80008000u, 0x80000000u),
  vec2<u32>(0x0000808bu, 0x00000000u),
  vec2<u32>(0x80000001u, 0x00000000u),
  vec2<u32>(0x80008081u, 0x80000000u),
  vec2<u32>(0x00008009u, 0x80000000u),
  vec2<u32>(0x0000008au, 0x00000000u),
  vec2<u32>(0x00000088u, 0x00000000u),
  vec2<u32>(0x80008009u, 0x00000000u),
  vec2<u32>(0x8000000au, 0x00000000u),
  vec2<u32>(0x8000808bu, 0x00000000u),
  vec2<u32>(0x0000008bu, 0x80000000u),
  vec2<u32>(0x00008089u, 0x80000000u),
  vec2<u32>(0x00008003u, 0x80000000u),
  vec2<u32>(0x00008002u, 0x80000000u),
  vec2<u32>(0x00000080u, 0x80000000u),
  vec2<u32>(0x0000800au, 0x00000000u),
  vec2<u32>(0x8000000au, 0x80000000u),
  vec2<u32>(0x80008081u, 0x80000000u),
  vec2<u32>(0x00008080u, 0x80000000u),
  vec2<u32>(0x80000001u, 0x00000000u),
  vec2<u32>(0x80008008u, 0x80000000u),
);

fn rotl64(v: vec2<u32>, n: u32) -> vec2<u32> {
  let nn = n & 63u;
  if (nn == 0u)  { return v; }
  if (nn == 32u) { return vec2<u32>(v.y, v.x); }
  if (nn < 32u) {
    let m = 32u - nn;
    return vec2<u32>(
      (v.x << nn) | (v.y >> m),
      (v.y << nn) | (v.x >> m),
    );
  }
  let s = nn - 32u;
  let m = 32u - s;
  return vec2<u32>(
    (v.y << s) | (v.x >> m),
    (v.x << s) | (v.y >> m),
  );
}

fn xor64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  return vec2<u32>(a.x ^ b.x, a.y ^ b.y);
}

fn andnot64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  return vec2<u32>((~a.x) & b.x, (~a.y) & b.y);
}

fn bswap32(v: u32) -> u32 {
  return ((v & 0x000000ffu) << 24u)
       | ((v & 0x0000ff00u) <<  8u)
       | ((v & 0x00ff0000u) >>  8u)
       | ((v & 0xff000000u) >> 24u);
}

fn keccak_f1600(s: ptr<function, array<vec2<u32>, 25>>) {
  for (var r: u32 = 0u; r < 24u; r = r + 1u) {
    let C0 = xor64(xor64(xor64(xor64((*s)[0],  (*s)[5]),  (*s)[10]), (*s)[15]), (*s)[20]);
    let C1 = xor64(xor64(xor64(xor64((*s)[1],  (*s)[6]),  (*s)[11]), (*s)[16]), (*s)[21]);
    let C2 = xor64(xor64(xor64(xor64((*s)[2],  (*s)[7]),  (*s)[12]), (*s)[17]), (*s)[22]);
    let C3 = xor64(xor64(xor64(xor64((*s)[3],  (*s)[8]),  (*s)[13]), (*s)[18]), (*s)[23]);
    let C4 = xor64(xor64(xor64(xor64((*s)[4],  (*s)[9]),  (*s)[14]), (*s)[19]), (*s)[24]);

    let D0 = xor64(C4, rotl64(C1, 1u));
    let D1 = xor64(C0, rotl64(C2, 1u));
    let D2 = xor64(C1, rotl64(C3, 1u));
    let D3 = xor64(C2, rotl64(C4, 1u));
    let D4 = xor64(C3, rotl64(C0, 1u));

    let b00 = xor64((*s)[ 0], D0);
    let b10 = rotl64(xor64((*s)[ 1], D1),  1u);
    let b20 = rotl64(xor64((*s)[ 2], D2), 62u);
    let b05 = rotl64(xor64((*s)[ 3], D3), 28u);
    let b15 = rotl64(xor64((*s)[ 4], D4), 27u);
    let b16 = rotl64(xor64((*s)[ 5], D0), 36u);
    let b01 = rotl64(xor64((*s)[ 6], D1), 44u);
    let b11 = rotl64(xor64((*s)[ 7], D2),  6u);
    let b21 = rotl64(xor64((*s)[ 8], D3), 55u);
    let b06 = rotl64(xor64((*s)[ 9], D4), 20u);
    let b07 = rotl64(xor64((*s)[10], D0),  3u);
    let b17 = rotl64(xor64((*s)[11], D1), 10u);
    let b02 = rotl64(xor64((*s)[12], D2), 43u);
    let b12 = rotl64(xor64((*s)[13], D3), 25u);
    let b22 = rotl64(xor64((*s)[14], D4), 39u);
    let b23 = rotl64(xor64((*s)[15], D0), 41u);
    let b08 = rotl64(xor64((*s)[16], D1), 45u);
    let b18 = rotl64(xor64((*s)[17], D2), 15u);
    let b03 = rotl64(xor64((*s)[18], D3), 21u);
    let b13 = rotl64(xor64((*s)[19], D4),  8u);
    let b14 = rotl64(xor64((*s)[20], D0), 18u);
    let b24 = rotl64(xor64((*s)[21], D1),  2u);
    let b09 = rotl64(xor64((*s)[22], D2), 61u);
    let b19 = rotl64(xor64((*s)[23], D3), 56u);
    let b04 = rotl64(xor64((*s)[24], D4), 14u);

    (*s)[ 0] = xor64(b00, andnot64(b01, b02));
    (*s)[ 1] = xor64(b01, andnot64(b02, b03));
    (*s)[ 2] = xor64(b02, andnot64(b03, b04));
    (*s)[ 3] = xor64(b03, andnot64(b04, b00));
    (*s)[ 4] = xor64(b04, andnot64(b00, b01));
    (*s)[ 5] = xor64(b05, andnot64(b06, b07));
    (*s)[ 6] = xor64(b06, andnot64(b07, b08));
    (*s)[ 7] = xor64(b07, andnot64(b08, b09));
    (*s)[ 8] = xor64(b08, andnot64(b09, b05));
    (*s)[ 9] = xor64(b09, andnot64(b05, b06));
    (*s)[10] = xor64(b10, andnot64(b11, b12));
    (*s)[11] = xor64(b11, andnot64(b12, b13));
    (*s)[12] = xor64(b12, andnot64(b13, b14));
    (*s)[13] = xor64(b13, andnot64(b14, b10));
    (*s)[14] = xor64(b14, andnot64(b10, b11));
    (*s)[15] = xor64(b15, andnot64(b16, b17));
    (*s)[16] = xor64(b16, andnot64(b17, b18));
    (*s)[17] = xor64(b17, andnot64(b18, b19));
    (*s)[18] = xor64(b18, andnot64(b19, b15));
    (*s)[19] = xor64(b19, andnot64(b15, b16));
    (*s)[20] = xor64(b20, andnot64(b21, b22));
    (*s)[21] = xor64(b21, andnot64(b22, b23));
    (*s)[22] = xor64(b22, andnot64(b23, b24));
    (*s)[23] = xor64(b23, andnot64(b24, b20));
    (*s)[24] = xor64(b24, andnot64(b20, b21));

    (*s)[0] = xor64((*s)[0], RC[r]);
  }
}

struct Uniforms {
  challenge: array<vec4<u32>, 2>,
  difficulty: array<vec4<u32>, 2>,
  nonce_base_lo: u32,
  nonce_base_hi: u32,
  _pad0: u32,
  _pad1: u32,
};

struct ResultBuffer {
  found: atomic<u32>,
  nonce_lo: u32,
  nonce_hi: u32,
  _pad: u32,
  hash: array<vec4<u32>, 2>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> result: ResultBuffer;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let thread_start = gid.x * ITERATIONS;
  for (var k: u32 = 0u; k < ITERATIONS; k = k + 1u) {
    let offset = thread_start + k;
    let added = u.nonce_base_lo + offset;
    let carry = select(0u, 1u, added < u.nonce_base_lo);
    let n_lo  = added;
    let n_hi  = u.nonce_base_hi + carry;

    var st: array<vec2<u32>, 25>;
    st[0] = vec2<u32>(u.challenge[0].x, u.challenge[0].y);
    st[1] = vec2<u32>(u.challenge[0].z, u.challenge[0].w);
    st[2] = vec2<u32>(u.challenge[1].x, u.challenge[1].y);
    st[3] = vec2<u32>(u.challenge[1].z, u.challenge[1].w);
    st[4] = vec2<u32>(0u, 0u);
    st[5] = vec2<u32>(0u, 0u);
    st[6] = vec2<u32>(0u, 0u);
    st[7] = vec2<u32>(bswap32(n_hi), bswap32(n_lo));
    st[8] = vec2<u32>(0x00000001u, 0x00000000u);
    st[ 9] = vec2<u32>(0u, 0u);
    st[10] = vec2<u32>(0u, 0u);
    st[11] = vec2<u32>(0u, 0u);
    st[12] = vec2<u32>(0u, 0u);
    st[13] = vec2<u32>(0u, 0u);
    st[14] = vec2<u32>(0u, 0u);
    st[15] = vec2<u32>(0u, 0u);
    st[16] = vec2<u32>(0u, 0x80000000u);
    st[17] = vec2<u32>(0u, 0u);
    st[18] = vec2<u32>(0u, 0u);
    st[19] = vec2<u32>(0u, 0u);
    st[20] = vec2<u32>(0u, 0u);
    st[21] = vec2<u32>(0u, 0u);
    st[22] = vec2<u32>(0u, 0u);
    st[23] = vec2<u32>(0u, 0u);
    st[24] = vec2<u32>(0u, 0u);

    keccak_f1600(&st);

    let h0 = bswap32(st[0].x);
    let h1 = bswap32(st[0].y);
    let h2 = bswap32(st[1].x);
    let h3 = bswap32(st[1].y);
    let h4 = bswap32(st[2].x);
    let h5 = bswap32(st[2].y);
    let h6 = bswap32(st[3].x);
    let h7 = bswap32(st[3].y);

    let d0 = u.difficulty[0].x;
    let d1 = u.difficulty[0].y;
    let d2 = u.difficulty[0].z;
    let d3 = u.difficulty[0].w;
    let d4 = u.difficulty[1].x;
    let d5 = u.difficulty[1].y;
    let d6 = u.difficulty[1].z;
    let d7 = u.difficulty[1].w;

    var lt = false;
    var settled = false;
    if (h0 < d0)      { lt = true;  settled = true; }
    else if (h0 > d0) {              settled = true; }
    if (!settled) { if (h1 < d1) { lt = true; settled = true; } else if (h1 > d1) { settled = true; } }
    if (!settled) { if (h2 < d2) { lt = true; settled = true; } else if (h2 > d2) { settled = true; } }
    if (!settled) { if (h3 < d3) { lt = true; settled = true; } else if (h3 > d3) { settled = true; } }
    if (!settled) { if (h4 < d4) { lt = true; settled = true; } else if (h4 > d4) { settled = true; } }
    if (!settled) { if (h5 < d5) { lt = true; settled = true; } else if (h5 > d5) { settled = true; } }
    if (!settled) { if (h6 < d6) { lt = true; settled = true; } else if (h6 > d6) { settled = true; } }
    if (!settled) { if (h7 < d7) { lt = true; } }

    if (lt) {
      let prior = atomicAdd(&result.found, 1u);
      if (prior == 0u) {
        result.nonce_lo = n_lo;
        result.nonce_hi = n_hi;
        result.hash[0]  = vec4<u32>(h0, h1, h2, h3);
        result.hash[1]  = vec4<u32>(h4, h5, h6, h7);
      }
      break;
    }
  }
}
`;

// ── App state ──────────────────────────────────────────────────────────
let consent = false;
let provider, signer, walletAddr, contract, eipProvider;
let device, pipeline, uniformBuf;
let resultBufs = [], readBufs = [], bindGroups = [];
let PIPELINE = 4;
let WORKGROUPS = 8192;
let stopFlag = false;
let mining = false;
let totalHashes = 0n;
let solutionsFound = 0;
let hrSamples = [];
let challengeBytes = null;
let difficultyBytes = null;
let currentEpoch = 0n;
let nonceCursor = 0n;
let testMode = false;
let testBits = 20;
let mode = "gpu";
let gpuName = "(not detected)";
let cpuCores = navigator.hardwareConcurrency || 4;
let cpuThreadsWanted = 0;
let cpuWorkers = [];
let cpuRunning = false;
let cpuHashesAcc = 0n;
let gpuHashesAcc = 0n;
let hrSamplesGpu = [];
let hrSamplesCpu = [];

// ── UI helpers ─────────────────────────────────────────────────────────
function fmtHashes(n) {
  n = Number(n);
  const u = ["", "k", "M", "G", "T"];
  let i = 0; while (n >= 1000 && i < u.length-1) { n /= 1000; i++; }
  return n.toFixed(2) + " " + u[i] + "H";
}
function shortHex(h, head=10, tail=8) {
  return h.length > head + tail + 2 ? h.slice(0, head) + "…" + h.slice(-tail) : h;
}
function hrFromSamples(samples) {
  if (samples.length === 0) return 0;
  const now = performance.now();
  const dt = (now - samples[0].t) / 1000;
  if (dt <= 0.001) return 0;
  const sum = samples.reduce((s,x)=>s+x.h, 0);
  return sum / dt;
}
function updateHashrateUI() {
  const hg = hrFromSamples(hrSamplesGpu);
  const hc = hrFromSamples(hrSamplesCpu);
  $("s_hr_gpu").textContent = (mode === "cpu") ? "—" : fmtHashes(hg) + "/s";
  $("s_hr_cpu").textContent = (mode === "gpu") ? "—" : fmtHashes(hc) + "/s · " + cpuWorkers.length + " threads";
  $("s_hr").textContent     = fmtHashes(hg + hc) + "/s";
  $("s_total").textContent  = totalHashes.toLocaleString("en-US");
}

// ── GPU detection + auto-tune ──────────────────────────────────────────
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
  gpuName = wgl || wgpu || "(not detected)";
  $("s_gpu").textContent = gpuName + (wgl && wgpu ? "  ·  " + wgpu : "");
  $("s_cpu").textContent = cpuCores + " logical threads";
  return gpuName;
}

function autoTuneFromGPU() {
  const n = (gpuName || "").toLowerCase();
  const HIGH = { wg: 32768, pp: 6 };
  const MID  = { wg: 16384, pp: 4 };
  const LOW  = { wg:  4096, pp: 2 };
  const MIN  = { wg:  1024, pp: 2 };
  let pick;
  if (/(rtx\s?[345]0|rtx\s?20[678]0|rx\s?[67]\d{3}|rx\s?6800|rx\s?6900|rx\s?7900|m[234]\s?(max|ultra)|a100|h100|l40)/i.test(n)) pick = HIGH;
  else if (/(rtx\s?20[567]0|gtx\s?16|gtx\s?10[678]0|rx\s?5\d{3}|rx\s?580|rx\s?vega|m[12](\spro)?|m[34]\s?pro|arc\s?a[78])/i.test(n)) pick = MID;
  else if (/(intel.*(uhd|hd|iris|xe)|amd\s?radeon\s?vega|adreno|mali|apple\s?gpu|apple\s?a\d|powervr)/i.test(n)) pick = LOW;
  else pick = MID;
  if (matchMedia("(pointer: coarse)").matches) pick = pick === HIGH ? MID : (pick === MID ? LOW : MIN);
  return pick;
}

// ── WebGPU setup ───────────────────────────────────────────────────────
async function initGPU() {
  if (!navigator.gpu) throw new Error("WebGPU not available (use a recent Chrome/Edge).");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No GPU adapter.");
  device = await adapter.requestDevice();
  device.lost.then(info => { setStatus("GPU device lost: " + info.message, "err"); stopFlag = true; });

  const module = device.createShaderModule({ code: SHADER });
  pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "main" }
  });

  uniformBuf = device.createBuffer({
    size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  rebuildPipelineBuffers();
}

function rebuildPipelineBuffers() {
  for (const b of resultBufs) try { b.destroy(); } catch {}
  for (const b of readBufs)   try { b.destroy(); } catch {}
  resultBufs = []; readBufs = []; bindGroups = [];
  for (let i = 0; i < PIPELINE; i++) {
    const rb = device.createBuffer({
      size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const mb = device.createBuffer({
      size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    resultBufs.push(rb);
    readBufs.push(mb);
    bindGroups.push(device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: rb } },
      ],
    }));
  }
}

// ── Wallet / contract ──────────────────────────────────────────────────
function pickProvider(kind) {
  if (kind === "phantom") {
    const p = window.phantom?.ethereum;
    if (!p) throw new Error("Phantom (Ethereum mode) not detected. Enable Ethereum in Phantom > Settings.");
    return p;
  }
  if (!window.ethereum) throw new Error("No EIP-1193 wallet (window.ethereum) detected.");
  return window.ethereum;
}

async function connectWallet(kind) {
  eipProvider = pickProvider(kind);
  provider = new ethers.BrowserProvider(eipProvider);
  await provider.send("eth_requestAccounts", []);
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) {
    try {
      await eipProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      });
      provider = new ethers.BrowserProvider(eipProvider);
    } catch (e) { throw new Error("Please switch to Ethereum mainnet."); }
  }
  signer = await provider.getSigner();
  walletAddr = (await signer.getAddress()).toLowerCase();
  $("s_wallet").textContent = walletAddr + "  (" + (kind === "phantom" ? "Phantom" : "default") + ")";
  if (walletAddr !== PAYOUT_TARGET) {
    setStatus("Connected wallet ≠ target payout address. Tokens will go to the connected wallet.", "warn");
  }
  contract = new ethers.Contract(CONTRACT, ABI, signer);

  eipProvider.on?.("accountsChanged", () => location.reload());
  eipProvider.on?.("chainChanged",   () => location.reload());
}

// ── On-chain reads ─────────────────────────────────────────────────────
async function refreshChainState() {
  if (testMode) return setupSyntheticState();
  const [chal, ms, bal] = await Promise.all([
    contract.getChallenge(walletAddr),
    contract.miningState(),
    contract.balanceOf(walletAddr),
  ]);
  challengeBytes = ethers.getBytes(chal);
  const diffBig  = ms[2];
  currentEpoch   = ms[5];
  difficultyBytes = ethers.getBytes(ethers.toBeHex(diffBig, 32));

  $("s_chal").textContent  = shortHex(chal);
  $("s_diff").textContent  = "0x" + difficultyBytes.reduce((s,b)=>s+b.toString(16).padStart(2,"0"),"").replace(/^0+/,"") || "0";
  $("s_epoch").textContent = currentEpoch.toString();
  $("s_bal").textContent   = ethers.formatUnits(bal, 18) + " HASH";
  if (cpuRunning) retargetCpuWorkers();
}

function setupSyntheticState() {
  challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const bits = Math.max(1, Math.min(255, testBits));
  const target = (1n << BigInt(256 - bits)) - 1n;
  difficultyBytes = ethers.getBytes(ethers.toBeHex(target, 32));
  currentEpoch = 0n;

  const chalHex = "0x" + Array.from(challengeBytes, b => b.toString(16).padStart(2,"0")).join("");
  $("s_chal").textContent  = shortHex(chalHex);
  $("s_diff").textContent  = bits + " bits (1 hit ~ every 2^" + bits + " hashes)";
  $("s_epoch").textContent = "test";
  $("s_bal").textContent   = "— (test mode, no tx)";
}

// ── Mining loop ────────────────────────────────────────────────────────
function bytes32ToU32LE(bytes) {
  const out = new Uint32Array(8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 32);
  for (let i = 0; i < 8; i++) out[i] = dv.getUint32(i*4, true);
  return out;
}
function bytes32ToU32BE(bytes) {
  const out = new Uint32Array(8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 32);
  for (let i = 0; i < 8; i++) out[i] = dv.getUint32(i*4, false);
  return out;
}

function writeUniform(nonceBase) {
  const u32 = new Uint32Array(24);
  u32.set(bytes32ToU32LE(challengeBytes), 0);
  u32.set(bytes32ToU32BE(difficultyBytes), 8);
  u32[16] = Number(nonceBase & 0xFFFFFFFFn);
  u32[17] = Number((nonceBase >> 32n) & 0xFFFFFFFFn);
  u32[18] = 0;
  u32[19] = 0;
  device.queue.writeBuffer(uniformBuf, 0, u32);
}

function enqueueSlot(slot, nonceBase) {
  device.queue.writeBuffer(resultBufs[slot], 0, new Uint32Array(16));
  writeUniform(nonceBase);

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroups[slot]);
  pass.dispatchWorkgroups(WORKGROUPS);
  pass.end();
  enc.copyBufferToBuffer(resultBufs[slot], 0, readBufs[slot], 0, 64);
  device.queue.submit([enc.finish()]);
}

async function readSlot(slot) {
  await readBufs[slot].mapAsync(GPUMapMode.READ);
  const r = new Uint32Array(readBufs[slot].getMappedRange().slice(0));
  readBufs[slot].unmap();
  return {
    found:    r[0] > 0,
    nonceLo:  r[1] >>> 0,
    nonceHi:  r[2] >>> 0,
    hash:     r.slice(4, 12),
  };
}

async function submitMine(nonce) {
  setStatus("Solution found — submitting mine() …", "");
  try {
    const gas = await contract.mine.estimateGas(nonce).catch(() => 200000n);
    const fee = await provider.getFeeData();
    const tx = await contract.mine(nonce, {
      gasLimit: (gas * 12n) / 10n,
      maxFeePerGas: fee.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
    });
    $("s_tx").textContent = tx.hash;
    setStatus("tx sent: " + shortHex(tx.hash) + " — awaiting confirmation…");
    const rcpt = await tx.wait();
    setStatus(rcpt.status === 1
      ? "✓ mint confirmed — re-fetching challenge"
      : "✗ tx reverted — re-fetching challenge", rcpt.status === 1 ? "" : "warn");
  } catch (e) {
    console.error(e);
    setStatus("mine() error: " + (e.shortMessage || e.message || e), "err");
  }
  try { await refreshChainState(); } catch (e) { console.warn(e); }
}

// ── CPU mining via Web Workers ─────────────────────────────────────────
const CPU_WORKER_SRC = String.raw`
self.importScripts("https://cdn.jsdelivr.net/npm/js-sha3@0.9.3/build/sha3.min.js");
let stop = false;
let myIdx = 0, total = 1;
let challenge = null, target = null, nonce = 0n;

function bytesLt(a, b) {
  for (let i = 0; i < 32; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

function run() {
  const buf = new Uint8Array(64);
  buf.set(challenge, 0);
  const REPORT_EVERY = 20000;
  const STEP = BigInt(total);
  let localHashes = 0;
  let lastReport = performance.now();
  while (!stop) {
    let n = nonce;
    for (let i = 63; i >= 32; i--) { buf[i] = Number(n & 0xFFn); n >>= 8n; }
    const hash = self.keccak_256.array(buf);
    if (bytesLt(hash, target)) {
      self.postMessage({ type: "found", nonce: "0x" + nonce.toString(16) });
    }
    nonce += STEP;
    localHashes++;
    if (localHashes >= REPORT_EVERY) {
      const now = performance.now();
      self.postMessage({ type: "progress", hashes: localHashes, dt: now - lastReport });
      localHashes = 0;
      lastReport = now;
    }
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") { myIdx = m.idx; total = m.total; }
  else if (m.type === "retarget") {
    challenge = new Uint8Array(m.challenge);
    target = new Uint8Array(m.target);
    nonce = BigInt(m.nonceStart) + BigInt(myIdx);
  }
  else if (m.type === "start") { stop = false; run(); }
  else if (m.type === "stop") { stop = true; }
};
`;

function effectiveThreadCount() {
  if (cpuThreadsWanted > 0) return Math.min(cpuThreadsWanted, 64);
  return Math.max(1, cpuCores - 1);
}

function startCpuWorkers() {
  if (cpuRunning) return;
  cpuRunning = true;
  const N = effectiveThreadCount();
  const blob = new Blob([CPU_WORKER_SRC], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const seed = crypto.getRandomValues(new Uint32Array(2));
  const nonceStart = ((BigInt(seed[1]) << 32n) | BigInt(seed[0])).toString();
  cpuWorkers = [];
  for (let i = 0; i < N; i++) {
    const w = new Worker(url);
    w.postMessage({ type: "init", idx: i, total: N });
    w.postMessage({
      type: "retarget",
      challenge: Array.from(challengeBytes),
      target:    Array.from(difficultyBytes),
      nonceStart,
    });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        cpuHashesAcc += BigInt(m.hashes);
        totalHashes  += BigInt(m.hashes);
        const now = performance.now();
        hrSamplesCpu.push({ t: now, h: m.hashes });
        while (hrSamplesCpu.length > 0 && now - hrSamplesCpu[0].t > 5000) hrSamplesCpu.shift();
      } else if (m.type === "found") {
        solutionsFound++;
        $("s_found").textContent = String(solutionsFound);
        const nonce = BigInt(m.nonce);
        if (testMode) {
          $("s_tx").textContent = "test hit (cpu) · nonce=" + m.nonce;
        } else {
          submitMine(nonce);
        }
      }
    };
    w.postMessage({ type: "start" });
    cpuWorkers.push(w);
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stopCpuWorkers() {
  for (const w of cpuWorkers) { try { w.postMessage({ type: "stop" }); w.terminate(); } catch {} }
  cpuWorkers = [];
  cpuRunning = false;
}

function retargetCpuWorkers() {
  const seed = crypto.getRandomValues(new Uint32Array(2));
  const nonceStart = ((BigInt(seed[1]) << 32n) | BigInt(seed[0])).toString();
  for (const w of cpuWorkers) {
    w.postMessage({
      type: "retarget",
      challenge: Array.from(challengeBytes),
      target:    Array.from(difficultyBytes),
      nonceStart,
    });
  }
}

async function mineLoop() {
  if (mining) return;
  mining = true;
  stopFlag = false;

  const seed = crypto.getRandomValues(new Uint32Array(2));
  nonceCursor = (BigInt(seed[1]) << 32n) | BigInt(seed[0]);
  const HASHES_PER_DISPATCH = () => BigInt(WORKGROUPS) * 64n * 16n;

  for (let s = 0; s < PIPELINE; s++) {
    enqueueSlot(s, nonceCursor);
    nonceCursor = (nonceCursor + HASHES_PER_DISPATCH()) & ((1n << 64n) - 1n);
  }

  let slot = 0;
  let lastEpochCheck = performance.now();

  while (!stopFlag) {
    const stepDone = HASHES_PER_DISPATCH();
    const t0 = performance.now();
    const res = await readSlot(slot);
    const t1 = performance.now();

    totalHashes += stepDone;
    gpuHashesAcc += stepDone;
    hrSamplesGpu.push({ t: t1, h: Number(stepDone) });
    while (hrSamplesGpu.length > 0 && t1 - hrSamplesGpu[0].t > 5000) hrSamplesGpu.shift();
    updateHashrateUI();

    if (!stopFlag) {
      enqueueSlot(slot, nonceCursor);
      nonceCursor = (nonceCursor + HASHES_PER_DISPATCH()) & ((1n << 64n) - 1n);
    }
    slot = (slot + 1) % PIPELINE;

    if (res.found) {
      solutionsFound++;
      $("s_found").textContent = String(solutionsFound);
      const nonce = (BigInt(res.nonceHi) << 32n) | BigInt(res.nonceLo);
      if (testMode) {
        $("s_tx").textContent = "test hit · nonce=0x" + nonce.toString(16);
      } else {
        submitMine(nonce);
      }
    }

    if (!testMode && t1 - lastEpochCheck > 30000) {
      lastEpochCheck = t1;
      try {
        const prevEpoch = currentEpoch;
        await refreshChainState();
        if (prevEpoch !== currentEpoch) setStatus("epoch rotated → " + currentEpoch.toString());
      } catch (e) { console.warn(e); }
    }
  }

  for (let i = 0; i < PIPELINE; i++) {
    try { await readSlot(slot); } catch {}
    slot = (slot + 1) % PIPELINE;
  }
  mining = false;
  setStatus("⏹ stopped.");
}

// ── Bootstrap ──────────────────────────────────────────────────────────
function readKnobs() {
  const wg = parseInt($("in_wg").value, 10);
  const pp = parseInt($("in_pipe").value, 10);
  const bb = parseInt($("in_bits").value, 10);
  const tt = parseInt($("in_threads").value, 10);
  if (Number.isFinite(wg) && wg >= 64 && wg <= 65535) WORKGROUPS = wg;
  if (Number.isFinite(pp) && pp >= 1  && pp <= 16)    PIPELINE  = pp;
  if (Number.isFinite(bb) && bb >= 1  && bb <= 255)   testBits  = bb;
  if (Number.isFinite(tt) && tt >= 0  && tt <= 64)    cpuThreadsWanted = tt;
  mode = $("sel_mode").value;
}

let uiTick = null;
let lastCpuChainCheck = 0;
function startUiTick() {
  if (uiTick) return;
  uiTick = setInterval(async () => {
    updateHashrateUI();
    if (!testMode && contract && cpuRunning && !mining) {
      const now = performance.now();
      if (now - lastCpuChainCheck > 30000) {
        lastCpuChainCheck = now;
        try { await refreshChainState(); } catch (e) { console.warn(e); }
      }
    }
  }, 500);
}
function stopUiTick() {
  if (uiTick) { clearInterval(uiTick); uiTick = null; }
}

async function startEngines() {
  if (mode === "gpu" || mode === "both") {
    if (!device) {
      setStatus("Init GPU…");
      await initGPU();
    }
    mineLoop();
  }
  if (mode === "cpu" || mode === "both") {
    if (!challengeBytes || !difficultyBytes) {
      if (!testMode) await refreshChainState();
      else setupSyntheticState();
    }
    startCpuWorkers();
  }
  startUiTick();
}

function stopEngines() {
  stopFlag = true;
  stopCpuWorkers();
  stopUiTick();
}

function describeEngines() {
  if (mode === "gpu")  return "GPU · " + WORKGROUPS + " wg × " + PIPELINE + " in-flight";
  if (mode === "cpu")  return "CPU · " + effectiveThreadCount() + " threads";
  return "GPU + CPU · " + WORKGROUPS + " wg × " + PIPELINE + " · " + effectiveThreadCount() + " threads";
}

async function startTestMode() {
  $("btn_connect").disabled = true;
  $("btn_phantom").disabled = true;
  $("btn_test").disabled = true;
  try {
    readKnobs();
    testMode = true;
    walletAddr = "(test mode — no wallet)";
    contract = null;
    $("s_wallet").textContent = walletAddr;
    setupSyntheticState();
    setStatus("TEST · " + describeEngines() + " · " + testBits + " bits target. No tx will be sent.");
    $("btn_stop").disabled = false;
    $("btn_start").style.display = "none";
    await startEngines();
  } catch (e) {
    setStatus(e.message || String(e), "err");
    $("btn_connect").disabled = false;
    $("btn_phantom").disabled = false;
    $("btn_test").disabled = false;
  }
}

async function startSession(kind) {
  $("btn_connect").disabled = true;
  $("btn_phantom").disabled = true;
  $("btn_test").disabled = true;
  try {
    readKnobs();
    testMode = false;
    setStatus("Connecting wallet…");
    await connectWallet(kind);
    setStatus("Reading contract state…");
    if (!device && (mode === "gpu" || mode === "both")) {
      setStatus("Initializing GPU…");
      await initGPU();
    }
    await refreshChainState();
    setStatus("Mining started · " + describeEngines());
    $("btn_stop").disabled = false;
    $("btn_start").style.display = "none";
    await startEngines();
  } catch (e) {
    setStatus(e.message || String(e), "err");
    $("btn_connect").disabled = false;
    $("btn_phantom").disabled = false;
    $("btn_test").disabled = false;
  }
}

$("btn_consent").onclick = () => {
  consent = true;
  document.getElementById("banner").style.display = "none";
  $("btn_connect").disabled = false;
  $("btn_phantom").disabled = false;
  $("btn_test").disabled    = false;
  setStatus("Pick a wallet — or TEST for a benchmark without a wallet.");
};

$("btn_connect").onclick = () => startSession("default");
$("btn_phantom").onclick = () => startSession("phantom");
$("btn_test").onclick    = () => startTestMode();

$("btn_stop").onclick = () => {
  stopEngines();
  $("btn_stop").disabled = true;
  $("btn_start").style.display = "";
  $("btn_start").disabled = false;
  setStatus("⏹ stopping… (draining pipeline)");
};

$("btn_start").onclick = async () => {
  if (mining && cpuRunning) return;
  readKnobs();
  if (device && resultBufs.length !== PIPELINE) rebuildPipelineBuffers();
  $("btn_start").disabled = true;
  $("btn_stop").disabled = false;
  $("btn_start").style.display = "none";
  setStatus("Mining resumed · " + describeEngines());
  await startEngines();
};

$("in_wg").onchange = () => {
  readKnobs();
  if (mining) setStatus("workgroups → " + WORKGROUPS + " (applied on next dispatch)");
};
$("in_pipe").onchange = () => {
  setStatus("pipeline → " + $("in_pipe").value + " (stop/resume to apply)");
};
$("in_bits").onchange = () => {
  readKnobs();
  if (testMode) {
    setupSyntheticState();
    setStatus("test bits → " + testBits + " (applied on next dispatch)");
  }
};

window.addEventListener("beforeunload", () => { stopFlag = true; stopCpuWorkers(); });

(async function boot() {
  $("s_cpu").textContent = (navigator.hardwareConcurrency || "?") + " logical threads";
  await detectGPU();
  const tune = autoTuneFromGPU();
  $("in_wg").value   = tune.wg;
  $("in_pipe").value = tune.pp;
  WORKGROUPS = tune.wg;
  PIPELINE   = tune.pp;
  setStatus("GPU detected → auto-tuned " + tune.wg + " wg × " + tune.pp + " in-flight. Click \"I agree\".");
})();

