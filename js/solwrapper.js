// solwrapper.js — wrap/unwrap SOL <-> wSOL via Phantom. 100% client-side.

// ── Solana program constants ───────────────────────────────────────────
const WSOL_MINT_STR = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_STR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOC_TOKEN_PROGRAM_STR = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_STR = "11111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000;

// Browser-friendly public RPCs. api.mainnet-beta.solana.com returns 403 to
// browser requests, so mainnet defaults to a keyless CORS-enabled endpoint.
const RPCS = {
  "mainnet-beta": "https://solana-rpc.publicnode.com",
  devnet: "https://api.devnet.solana.com",
};

// ── DOM helpers ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function setWrapStatus(msg, cls) {
  const el = $("w_status");
  el.textContent = msg;
  el.className = cls || "";
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
  // Compute the wSOL account address up front — it doesn't need the network.
  let ata = null;
  try {
    ata = wsolAta(owner);
    $("s_ata").textContent = ata.toString();
  } catch (e) {
    $("s_ata").textContent = "error: " + e.message;
  }
  try {
    const lamports = await conn.getBalance(owner, "confirmed");
    $("s_sol").textContent = (lamports / LAMPORTS_PER_SOL).toFixed(9) + " SOL";
  } catch (e) {
    $("s_sol").textContent = "rpc error (try a custom RPC)";
  }
  if (ata) {
    try {
      const bal = await conn.getTokenAccountBalance(ata, "confirmed");
      $("s_wsol").textContent = (bal.value.uiAmount ?? 0) + " wSOL";
    } catch (e) {
      $("s_wsol").textContent = "0 wSOL (no account yet)";
    }
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

// ── Wire up ────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  $("btn_connect").addEventListener("click", doConnect);
  $("btn_wrap").addEventListener("click", doWrap);
  $("btn_unwrap").addEventListener("click", doUnwrap);
  $("btn_refresh").addEventListener("click", () => { refreshBalances(); });
  $("sel_net").addEventListener("change", () => { invalidateConnection(); refreshBalances(); });
  $("in_rpc").addEventListener("change", () => { invalidateConnection(); refreshBalances(); });

  if (window.solana && window.solana.isPhantom) {
    window.solana.on && window.solana.on("disconnect", () => {
      walletAddr = null;
      $("s_wallet").textContent = "—";
      $("btn_connect").textContent = "connect Phantom";
    });
  }
});
