/**
 * Dev tool: recover the gatekeeper circuit's input signal names from
 * gatekeeper.wasm. Circom's WASM witness calculator addresses signals by
 * FNV-1a hash; getInputSignalSize(hash) returns the element count for a real
 * input signal and 0 for an unknown name, which turns a candidate-name
 * dictionary into an oracle.
 *
 * This is how the production input mapping in src/decision.ts was derived:
 *   taskId, registeredVkHash, proofVkHash, minimum, publicBalance,
 *   expiryBlock, currentBlock, recipient, conditionRecipient, amount,
 *   maxTransfer, decision, salt   (13 inputs, all size 1; getInputSize() = 13)
 *
 * Usage: node scripts/probe-signals.js [path-to-gatekeeper.wasm]
 */
const fs = require("fs");
const path = require("path");
const { WitnessCalculatorBuilder } = require("circom_runtime");

function fnvHash(str) {
  const M = 2n ** 64n;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h *= 0x100000001b3n;
    h %= M;
  }
  return h.toString(16).padStart(16, "0");
}

const CANDIDATES = [
  "taskId", "registeredVkHash", "proofVkHash", "minimum", "publicBalance",
  "expiryBlock", "currentBlock", "recipient", "conditionRecipient", "amount",
  "maxTransfer", "decision", "salt", "proofTxHash", "proofTx", "balance",
  "threshold", "vkHash", "commitment", "nullifier",
];

(async () => {
  const wasmPath =
    process.argv[2] || path.resolve(__dirname, "..", "circuits", "gatekeeper.wasm");
  const wc = await WitnessCalculatorBuilder(fs.readFileSync(wasmPath));
  const ex = wc.instance.exports;
  console.log("getInputSize():", ex.getInputSize());
  for (const name of CANDIDATES) {
    const h = fnvHash(name);
    const size = ex.getInputSignalSize(parseInt(h.slice(0, 8), 16), parseInt(h.slice(8, 16), 16));
    if (size > 0) console.log(`  input signal: ${name} (size ${size})`);
  }
})();
