/* js/sol_miner.js */
"use strict";

const $ = id => document.getElementById(id);
const setStatus = (msg, cls="") => { const el=$("status"); el.textContent=msg; el.className=cls; };

// ── Default config ─────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  rpc: "https://api.devnet.solana.com",
  programId: "4powMintContractAddress11111111111111111",
  mint: "MintAddressPlaceholder1111111111111111",
  pda: "StatePDAPlaceholder111111111111111111"
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const saved = localStorage.getItem("sol_miner_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      config = { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load config from localStorage", e);
  }
  $("in_rpc").value = config.rpc;
  $("in_prog").value = config.programId;
  $("in_mint").value = config.mint;
  $("in_pda").value = config.pda;
}

function saveConfig() {
  config.rpc = $("in_rpc").value.trim();
  config.programId = $("in_prog").value.trim();
  config.mint = $("in_mint").value.trim();
  config.pda = $("in_pda").value.trim();
  try {
    localStorage.setItem("sol_miner_config", JSON.stringify(config));
    setStatus("Configuration saved!");
  } catch (e) {
    setStatus("Error saving configuration", "err");
  }
}

// ── WebGPU Shader ──────────────────────────────────────────────────────
const SHADER = String.raw`
// Keccak round constants
const RC: array<vec2<u32>, 24> = array<vec2<u32>, 24>(
  vec2<u32>(0x00000001u, 0x00000000u), vec2<u32>(0x00008082u, 0x00000000u),
  vec2<u32>(0x0000808au, 0x80000000u), vec2<u32>(0x80008000u, 0x80000000u),
  vec2<u32>(0x0000808bu, 0x00000000u), vec2<u32>(0x80000001u, 0x00000000u),
  vec2<u32>(0x80008081u, 0x80000000u), vec2<u32>(0x00008009u, 0x80000000u),
  vec2<u32>(0x0000008au, 0x00000000u), vec2<u32>(0x00000088u, 0x00000000u),
  vec2<u32>(0x80008009u, 0x00000000u), vec2<u32>(0x8000000au, 0x00000000u),
  vec2<u32>(0x8000808bu, 0x00000000u), vec2<u32>(0x0000008bu, 0x80000000u),
  vec2<u32>(0x00008089u, 0x80000000u), vec2<u32>(0x00008003u, 0x80000000u),
  vec2<u32>(0x00008002u, 0x80000000u), vec2<u32>(0x00000080u, 0x80000000u),
  vec2<u32>(0x0000800au, 0x00000000u), vec2<u32>(0x8000000au, 0x80000000u),
  vec2<u32>(0x80008081u, 0x80000000u), vec2<u32>(0x00008080u, 0x80000000u),
  vec2<u32>(0x80000001u, 0x00000000u), vec2<u32>(0x80008008u, 0x80000000u)
);

fn rotl64(v: vec2<u32>, n: u32) -> vec2<u32> {
  let nn = n & 63u;
  if (nn == 0u)  { return v; }
  if (nn == 32u) { return vec2<u32>(v.y, v.x); }
  if (nn < 32u) {
    let m = 32u - nn;
    return vec2<u32>((v.x << nn) | (v.y >> m), (v.y << nn) | (v.x >> m));
  }
  let s = nn - 32u;
  let m = 32u - s;
  return vec2<u32>((v.y << s) | (v.x >> m), (v.x << s) | (v.y >> m));
}

fn xor64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  return vec2<u32>(a.x ^ b.x, a.y ^ b.y);
}

fn andnot64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  return vec2<u32>((~a.x) & b.x, (~a.y) & b.y);
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
  miner: array<vec4<u32>, 2>,
  difficulty: u32,
  nonce_base_lo: u32,
  nonce_base_hi: u32,
  _pad: u32,
};

struct ResultBuffer {
  found: atomic<u32>,
  nonce_lo: u32,
  nonce_hi: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> result: ResultBuffer;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let thread_start = gid.x * 16u;
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
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
    st[4] = vec2<u32>(u.miner[0].x, u.miner[0].y);
    st[5] = vec2<u32>(u.miner[0].z, u.miner[0].w);
    st[6] = vec2<u32>(u.miner[1].x, u.miner[1].y);
    st[7] = vec2<u32>(u.miner[1].z, u.miner[1].w);
    st[8] = vec2<u32>(n_lo, n_hi);
    st[9] = vec2<u32>(0x00000001u, 0x00000000u);
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

    var ok = true;
    if (u.difficulty >= 1u && (st[0].x & 0x000000ffu) != 0u) { ok = false; }
    if (u.difficulty >= 2u && (st[0].x & 0x0000ff00u) != 0u) { ok = false; }
    if (u.difficulty >= 3u && (st[0].x & 0x00ff0000u) != 0u) { ok = false; }
    if (u.difficulty >= 4u && (st[0].x & 0xff000000u) != 0u) { ok = false; }
    if (u.difficulty >= 5u && (st[0].y & 0x000000ffu) != 0u) { ok = false; }
    if (u.difficulty >= 6u && (st[0].y & 0x0000ff00u) != 0u) { ok = false; }
    if (u.difficulty >= 7u && (st[0].y & 0x00ff0000u) != 0u) { ok = false; }
    if (u.difficulty >= 8u && (st[0].y & 0xff000000u) != 0u) { ok = false; }

    if (ok) {
      let prior = atomicAdd(&result.found, 1u);
      if (prior == 0u) {
        result.nonce_lo = n_lo;
        result.nonce_hi = n_hi;
      }
      break;
    }
  }
}
`;

// ── Solana App State ────────────────────────────────────────────────────
let walletAddr = null;
let connection = null;
let device = null, pipeline = null, uniformBuf = null;
let resultBufs = [], readBufs = [], bindGroups = [];
let PIPELINE = 4;
let WORKGROUPS = 8192;
let stopFlag = false;
let mining = false;
let totalHashes = 0n;
let solutionsFound = 0;
let challengeBytes = null;
let difficultyBytes = 0;
let testMode = false;
let testBits = 3;
let mode = "gpu";
let gpuName = "(not detected)";
let cpuCores = navigator.hardwareConcurrency || 4;
let cpuThreadsWanted = 0;
let cpuWorkers = [];
let cpuRunning = false;
let hrSamplesGpu = [];
let hrSamplesCpu = [];
let consent = false;

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

// ── GPU detection ──────────────────────────────────────────────────────
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
        }
      }
    } catch {}
  }
  gpuName = wgl || wgpu || "(not detected)";
  $("s_gpu").textContent = gpuName + (wgl && wgpu ? "  ·  " + wgpu : "");
  $("s_cpu").textContent = cpuCores + " logical threads";
  return gpuName;
}

// ── WebGPU Setup ───────────────────────────────────────────────────────
async function initGPU() {
  if (!navigator.gpu) throw new Error("WebGPU is not available in your browser.");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No GPU adapter found.");
  device = await adapter.requestDevice();
  device.lost.then(info => { setStatus("GPU device lost: " + info.message, "err"); stopFlag = true; });

  const module = device.createShaderModule({ code: SHADER });
  pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "main" }
  });

  uniformBuf = device.createBuffer({
    size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  rebuildPipelineBuffers();
}

// ── Pipeline Buffers ───────────────────────────────────────────────────
function rebuildPipelineBuffers() {
  for (const b of resultBufs) try { b.destroy(); } catch {}
  for (const b of readBufs)   try { b.destroy(); } catch {}
  resultBufs = []; readBufs = []; bindGroups = [];
  for (let i = 0; i < PIPELINE; i++) {
    const rb = device.createBuffer({
      size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    const mb = device.createBuffer({
      size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
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

// ── Phantom Wallet Connection ──────────────────────────────────────────
async function connectWallet() {
  if (!window.solana || !window.solana.isPhantom) {
    throw new Error("Phantom Wallet extension was not detected.");
  }
  setStatus("Connecting to Phantom Wallet...");
  const resp = await window.solana.connect();
  walletAddr = resp.publicKey.toString();
  $("s_wallet").textContent = walletAddr;
  setStatus("Phantom Wallet connected.");
}

// ── On-chain Reads ─────────────────────────────────────────────────────
async function refreshChainState() {
  if (testMode) return setupSyntheticState();
  if (!connection) {
    connection = new window.solanaWeb3.Connection(config.rpc, "confirmed");
  }
  setStatus("Reading contract state from Solana...");
  try {
    const pdaPubkey = new window.solanaWeb3.PublicKey(config.pda);
    const acc = await connection.getAccountInfo(pdaPubkey);
    if (!acc) {
      throw new Error("PDA state account not found on Solana. Make sure you initialized the state account.");
    }
    
    // Decode MiningState: 8 bytes discriminator + 32 bytes challenge + 4 bytes difficulty (u32)
    challengeBytes = new Uint8Array(acc.data.slice(8, 8 + 32));
    const view = new DataView(acc.data.buffer, acc.data.byteOffset, acc.data.byteLength);
    difficultyBytes = view.getUint32(8 + 32, true);

    const chalHex = Array.from(challengeBytes, b => b.toString(16).padStart(2,"0")).join("");
    $("s_chal").textContent = shortHex("0x" + chalHex);
    $("s_diff").textContent = difficultyBytes + " zero byte(s) required (" + (difficultyBytes * 8) + " bits)";
    $("s_epoch").textContent = "Active";
    $("s_bal").textContent = "SPL Token Connected";
    if (cpuRunning) retargetCpuWorkers();
  } catch (e) {
    console.error(e);
    setStatus("Contract error: " + e.message, "err");
  }
}

function setupSyntheticState() {
  challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  difficultyBytes = testBits;

  const chalHex = Array.from(challengeBytes, b => b.toString(16).padStart(2,"0")).join("");
  $("s_chal").textContent = shortHex("0x" + chalHex);
  $("s_diff").textContent = difficultyBytes + " zero byte(s) required (TEST mode)";
  $("s_epoch").textContent = "test";
  $("s_bal").textContent = "— (test mode)";
}

// ── Mining loop ────────────────────────────────────────────────────────
function writeUniform(nonceBase) {
  const u32 = new Uint32Array(20);
  
  // write challenge
  const chalDV = new DataView(challengeBytes.buffer, challengeBytes.byteOffset, 32);
  for (let i = 0; i < 8; i++) u32[i] = chalDV.getUint32(i*4, true);

  // write miner pubkey
  const minerPub = new window.solanaWeb3.PublicKey(walletAddr);
  const minerBytes = minerPub.toBytes();
  const minerDV = new DataView(minerBytes.buffer, minerBytes.byteOffset, 32);
  for (let i = 0; i < 8; i++) u32[8 + i] = minerDV.getUint32(i*4, true);

  // write settings
  u32[16] = difficultyBytes;
  u32[17] = Number(nonceBase & 0xFFFFFFFFn);
  u32[18] = Number((nonceBase >> 32n) & 0xFFFFFFFFn);
  u32[19] = 0; // pad

  device.queue.writeBuffer(uniformBuf, 0, u32);
}

function enqueueSlot(slot, nonceBase) {
  device.queue.writeBuffer(resultBufs[slot], 0, new Uint32Array(4));
  writeUniform(nonceBase);

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroups[slot]);
  pass.dispatchWorkgroups(WORKGROUPS);
  pass.end();
  enc.copyBufferToBuffer(resultBufs[slot], 0, readBufs[slot], 0, 16);
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
  };
}

async function submitMine(nonce) {
  setStatus("Solution found! Sending Solana transaction...", "");
  try {
    const { Transaction, TransactionInstruction, PublicKey } = window.solanaWeb3;
    const minerWalletPubkey = new PublicKey(walletAddr);
    
    // Derive Associated Token Account (ATA) for miner's token
    const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2xr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    
    const [minerTokenAccountPubkey] = PublicKey.findProgramAddressSync(
      [
        minerWalletPubkey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        new PublicKey(config.mint).toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Borsh serialization: 8 bytes discriminator + 8 bytes nonce LE
    const data = new Uint8Array(16);
    data.set([0x51, 0xc7, 0x69, 0x4f, 0x4a, 0x3e, 0x78, 0xa6], 0); // global:mine
    let temp = nonce;
    for (let i = 0; i < 8; i++) {
      data[8 + i] = Number(temp & 255n);
      temp >>= 8n;
    }

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(config.pda), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(config.mint), isSigner: false, isWritable: true },
        { pubkey: minerTokenAccountPubkey, isSigner: false, isWritable: true },
        { pubkey: minerWalletPubkey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: new PublicKey(config.programId),
      data: data,
    });

    const blockhashInfo = await connection.getLatestBlockhash();
    const tx = new Transaction().add(instruction);
    tx.recentBlockhash = blockhashInfo.blockhash;
    tx.feePayer = minerWalletPubkey;

    setStatus("Phantom signature required...");
    const { signature } = await window.solana.signAndSendTransaction(tx);
    $("s_tx").innerHTML = `<a href="https://solscan.io/tx/${signature}?cluster=devnet" target="_blank">${shortHex(signature)}</a>`;
    setStatus("Transaction sent! Confirming transaction...");
    await connection.confirmTransaction(signature, "confirmed");
    setStatus("✓ Mining confirmed on Solana! Fetching new challenge...");
  } catch (e) {
    console.error(e);
    setStatus("Error during mine(): " + (e.message || String(e)), "err");
  }
  try { await refreshChainState(); } catch (e) { console.warn(e); }
}

// ── CPU Mining via Web Workers ─────────────────────────────────────────
const CPU_WORKER_SRC = String.raw`
self.importScripts("https://cdn.jsdelivr.net/npm/js-sha3@0.9.3/build/sha3.min.js");
let stop = false;
let myIdx = 0, total = 1;
let challenge = null, minerBytes = null, difficulty = 0, nonce = 0n;

function run() {
  const buf = new Uint8Array(72);
  buf.set(challenge, 0);
  buf.set(minerBytes, 32);
  const REPORT_EVERY = 20000;
  const STEP = BigInt(total);
  let localHashes = 0;
  let lastReport = performance.now();
  while (!stop) {
    let n = nonce;
    for (let i = 0; i < 8; i++) {
      buf[64 + i] = Number(n & 255n);
      n >>= 8n;
    }
    const hash = self.keccak_25_256 ? self.keccak_256.array(buf) : self.keccak_256.array(buf);
    
    let match = true;
    for (let i = 0; i < difficulty; i++) {
      if (hash[i] !== 0) {
        match = false;
        break;
      }
    }

    if (match) {
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
    minerBytes = new Uint8Array(m.minerBytes);
    difficulty = m.difficulty;
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
      minerBytes: Array.from(new window.solanaWeb3.PublicKey(walletAddr).toBytes()),
      difficulty: difficultyBytes,
      nonceStart,
    });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        totalHashes += BigInt(m.hashes);
        const now = performance.now();
        hrSamplesCpu.push({ t: now, h: m.hashes });
        while (hrSamplesCpu.length > 0 && now - hrSamplesCpu[0].t > 5000) hrSamplesCpu.shift();
      } else if (m.type === "found") {
        solutionsFound++;
        $("s_found").textContent = String(solutionsFound);
        const nonce = BigInt(m.nonce);
        if (testMode) {
          $("s_tx").textContent = "Hit test (CPU) nonce=" + m.nonce;
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
      minerBytes: Array.from(new window.solanaWeb3.PublicKey(walletAddr).toBytes()),
      difficulty: difficultyBytes,
      nonceStart,
    });
  }
}

async function mineLoop() {
  if (mining) return;
  mining = true;
  stopFlag = false;

  const seed = crypto.getRandomValues(new Uint32Array(2));
  let nonceCursor = (BigInt(seed[1]) << 32n) | BigInt(seed[0]);
  const HASHES_PER_DISPATCH = () => BigInt(WORKGROUPS) * 64n * 16n;

  for (let s = 0; s < PIPELINE; s++) {
    enqueueSlot(s, nonceCursor);
    nonceCursor = (nonceCursor + HASHES_PER_DISPATCH()) & ((1n << 64n) - 1n);
  }

  let slot = 0;
  let lastEpochCheck = performance.now();

  while (!stopFlag) {
    const stepDone = HASHES_PER_DISPATCH();
    const res = await readSlot(slot);
    const t1 = performance.now();

    totalHashes += stepDone;
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
        $("s_tx").textContent = "Hit test (GPU) nonce=0x" + nonce.toString(16);
      } else {
        submitMine(nonce);
      }
    }

    if (!testMode && t1 - lastEpochCheck > 30000) {
      lastEpochCheck = t1;
      try {
        await refreshChainState();
      } catch (e) { console.warn(e); }
    }
  }

  for (let i = 0; i < PIPELINE; i++) {
    try { await readSlot(slot); } catch {}
    slot = (slot + 1) % PIPELINE;
  }
  mining = false;
  setStatus("⏹ Stopped.");
}

// ── Bootstrap & UI Wire ────────────────────────────────────────────────
function readKnobs() {
  const wg = parseInt($("in_wg").value, 10);
  const pp = parseInt($("in_pipe").value, 10);
  const bb = parseInt($("in_bits").value, 10);
  const tt = parseInt($("in_threads").value, 10);
  if (Number.isFinite(wg) && wg >= 64 && wg <= 65535) WORKGROUPS = wg;
  if (Number.isFinite(pp) && pp >= 1  && pp <= 16)    PIPELINE  = pp;
  if (Number.isFinite(bb) && bb >= 1  && bb <= 8)     testBits  = bb;
  if (Number.isFinite(tt) && tt >= 0  && tt <= 64)    cpuThreadsWanted = tt;
  mode = $("sel_mode").value;
}

let uiTick = null;
let lastCpuChainCheck = 0;
function startUiTick() {
  if (uiTick) return;
  uiTick = setInterval(async () => {
    updateHashrateUI();
    if (!testMode && connection && cpuRunning && !mining) {
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
      setStatus("Initializing GPU...");
      await initGPU();
    }
    mineLoop();
  }
  if (mode === "cpu" || mode === "both") {
    if (!challengeBytes) {
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
  if (mode === "gpu")  return "GPU · " + WORKGROUPS + " wg × " + PIPELINE;
  if (mode === "cpu")  return "CPU · " + effectiveThreadCount() + " threads";
  return "GPU + CPU · " + WORKGROUPS + " wg × " + PIPELINE + " · " + effectiveThreadCount() + " threads";
}

async function startTestMode() {
  $("btn_connect").disabled = true;
  $("btn_test").disabled = true;
  try {
    readKnobs();
    testMode = true;
    walletAddr = "YourSolanaWalletAddressPlaceholder11111111";
    $("s_wallet").textContent = walletAddr;
    setupSyntheticState();
    setStatus("TEST · " + describeEngines() + " · " + testBits + " zero bytes difficulty. No SOL required.");
    $("btn_stop").disabled = false;
    $("btn_start").style.display = "none";
    await startEngines();
  } catch (e) {
    setStatus(e.message || String(e), "err");
    $("btn_connect").disabled = false;
    $("btn_test").disabled = false;
  }
}

async function startSession() {
  $("btn_connect").disabled = true;
  $("btn_test").disabled = true;
  try {
    readKnobs();
    testMode = false;
    await connectWallet();
    await refreshChainState();
    if (!device && (mode === "gpu" || mode === "both")) {
      setStatus("Initializing GPU...");
      await initGPU();
    }
    setStatus("Mining started · " + describeEngines());
    $("btn_stop").disabled = false;
    $("btn_start").style.display = "none";
    await startEngines();
  } catch (e) {
    setStatus(e.message || String(e), "err");
    $("btn_connect").disabled = false;
    $("btn_test").disabled = false;
  }
}

// ── Buttons Wire ───────────────────────────────────────────────────────
$("btn_connect").onclick = () => startSession();
$("btn_test").onclick    = () => startTestMode();
$("btn_save_config").onclick = () => saveConfig();

$("btn_stop").onclick = () => {
  stopEngines();
  $("btn_stop").disabled = true;
  $("btn_start").style.display = "";
  $("btn_start").disabled = false;
  setStatus("⏹ Stopping... Draining pipeline.");
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
    setStatus("test difficulty → " + testBits + " (applied on next dispatch)");
  }
};

window.addEventListener("beforeunload", () => { stopFlag = true; stopCpuWorkers(); });

// ── Solana Guide Event Handlers ────────────────────────────────────────
window.switchGuideTab = function(tabId) {
  const tabs = document.querySelectorAll('.guide-tab-btn');
  const contents = document.querySelectorAll('.guide-tab-content');
  
  tabs.forEach(tab => tab.classList.remove('active'));
  contents.forEach(content => content.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  
  tabs.forEach(tab => {
    if (tab.getAttribute('onclick') && tab.getAttribute('onclick').includes(tabId)) {
      tab.classList.add('active');
    }
  });
};

const btnToggleGuide = document.getElementById('btn_toggle_guide');
if (btnToggleGuide) {
  btnToggleGuide.onclick = () => {
    const panel = document.getElementById('solana_guide_panel');
    if (panel) {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        btnToggleGuide.textContent = "🔽 Close Solana Memecoin Guide";
        panel.scrollIntoView({ behavior: 'smooth' });
      } else {
        btnToggleGuide.textContent = "💡 How to create & mine your own Solana Memecoin (PoW)?";
      }
    }
  };
}

// ── Consent Button Handler ─────────────────────────────────────────────
$("btn_consent").onclick = () => {
  consent = true;
  document.getElementById("banner").style.display = "none";
  $("btn_connect").disabled = false;
  $("btn_test").disabled    = false;
  setStatus("Choose a wallet or run TEST for a benchmark.");
};

(async function boot() {
  loadConfig();
  $("s_cpu").textContent = (navigator.hardwareConcurrency || "?") + " logical threads";
  await detectGPU();
  const tune = { wg: 8192, pp: 4 };
  $("in_wg").value   = tune.wg;
  $("in_pipe").value = tune.pp;
  WORKGROUPS = tune.wg;
  PIPELINE   = tune.pp;
  setStatus("Ready. Click \"I agree\" in the banner below to start.");
})();
