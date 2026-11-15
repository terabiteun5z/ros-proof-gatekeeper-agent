import type { Config } from "./config";
import type { Groth16Proof } from "./types";

/**
 * Kurier (zkVerify) proof submission — mainnet.
 *
 * Shape from the /build page and docs.zkverify.io:
 *   POST {KURIER_API_URL}/submit-proof/{KURIER_API_KEY}
 *   { proofType: "groth16", vkRegistered: true,
 *     proofOptions: { library: "snarkjs", curve: "bn128" },
 *     proofData: { proof, publicSignals, vk: <vk_hash> } }
 *   -> { jobId, optimisticVerify }
 *   GET {KURIER_API_URL}/job-status/{KURIER_API_KEY}/{jobId}
 *   lifecycle: Queued -> Valid -> Submitted -> IncludedInBlock -> Finalized | Failed
 *   The txHash is already present from the Submitted status onward (measured
 *   live 2026-11-15: txHash at ~4 s, Finalized at ~27 s), so polling returns
 *   as soon as a txHash is known instead of blocking the task response on
 *   finalization; the Kurier job keeps finalizing server-side regardless.
 *
 * The gatekeeper vk_hash is already registered on mainnet, so
 * vkRegistered: true and no register-vk call is needed.
 *
 * This module never throws: any failure returns null / a non-final status and
 * the caller still answers the task with the proof + public_signals.
 */
export interface KurierOutcome {
  jobId: string;
  status: string;
  txHash?: string;
  finalized: boolean;
}

export async function submitProofAndPoll(
  cfg: Config,
  proof: Groth16Proof,
  publicSignals: string[],
  budgetMs: number,
): Promise<KurierOutcome | null> {
  if (!cfg.kurierApiKey) {
    console.log("[kurier] KURIER_API_KEY not set — skipping zkVerify submission");
    return null;
  }
  const key = cfg.kurierApiKey;
  const deadline = Date.now() + Math.max(0, budgetMs);
  try {
    const submitRes = await fetch(`${cfg.kurierApiUrl}/submit-proof/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: "bn128" },
        proofData: { proof, publicSignals, vk: cfg.gatekeeperVkHash },
      }),
    });
    if (!submitRes.ok) {
      console.error(`[kurier] submit-proof HTTP ${submitRes.status}`);
      return null;
    }
    const job = (await submitRes.json()) as { jobId?: string; optimisticVerify?: string };
    if (!job.jobId) {
      console.error("[kurier] submit-proof response missing jobId");
      return null;
    }
    console.log(
      `[kurier] job ${job.jobId} submitted (optimisticVerify=${job.optimisticVerify ?? "n/a"})`,
    );

    let status = "Submitted";
    let lastTxHash: string | undefined;
    while (Date.now() < deadline) {
      await sleep(Math.min(cfg.kurierPollIntervalMs, Math.max(0, deadline - Date.now())));
      const statusRes = await fetch(
        `${cfg.kurierApiUrl}/job-status/${key}/${job.jobId}`,
      );
      if (!statusRes.ok) {
        console.error(`[kurier] job-status HTTP ${statusRes.status}`);
        continue;
      }
      const s = (await statusRes.json()) as {
        status?: string;
        txHash?: string;
        transactionInfo?: { txHash?: string };
      };
      status = s.status ?? status;
      const txHash = s.txHash ?? s.transactionInfo?.txHash;
      if (txHash) lastTxHash = txHash;
      if (status === "Failed") {
        return { jobId: job.jobId, status, txHash, finalized: false };
      }
      if (txHash) {
        // The on-chain transaction exists from Submitted onward; return its
        // hash now and let finalization complete server-side at Kurier.
        return { jobId: job.jobId, status, txHash, finalized: status === "Finalized" };
      }
    }
    console.log(`[kurier] job ${job.jobId} produced no txHash within budget (last status=${status})`);
    return { jobId: job.jobId, status, txHash: lastTxHash, finalized: false };
  } catch (err) {
    console.error("[kurier] submission error:", (err as Error).message);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
