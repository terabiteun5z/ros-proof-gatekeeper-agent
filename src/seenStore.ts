import * as fs from "fs";
import * as path from "path";

/**
 * Seen-set for proof_tx references ("The proof reference has not already been
 * used for another task" — /build Security checklist; PROOF_REUSED trap).
 *
 * In-memory Set is authoritative for the life of the process; a JSON file
 * backs it across restarts (best-effort: on serverless the file lives in /tmp
 * and may vanish on cold start — see README for the operational implication).
 * Also keeps a task_id -> serialized response cache so a redelivered task is
 * answered idempotently instead of being misread as proof reuse.
 */
export class SeenStore {
  private seenProofTx = new Set<string>();
  private responseByTaskId = new Map<string, string>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as {
        proofTx?: string[];
        responses?: Record<string, string>;
      };
      for (const tx of data.proofTx ?? []) this.seenProofTx.add(normalizeTx(tx));
      for (const [k, v] of Object.entries(data.responses ?? {})) {
        this.responseByTaskId.set(k, v);
      }
    } catch {
      /* missing/corrupt file -> start empty (fail-open for storage, fail-closed for policy) */
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          proofTx: [...this.seenProofTx],
          responses: Object.fromEntries(this.responseByTaskId),
        }),
      );
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[seen-store] persist failed:", (err as Error).message);
    }
  }

  hasProofTx(proofTx: string): boolean {
    return this.seenProofTx.has(normalizeTx(proofTx));
  }

  recordProofTx(proofTx: string): void {
    const key = normalizeTx(proofTx);
    if (!key) return;
    if (!this.seenProofTx.has(key)) {
      this.seenProofTx.add(key);
      this.persist();
    }
  }

  getResponse(taskId: string): string | null {
    return this.responseByTaskId.get(taskId) ?? null;
  }

  recordResponse(taskId: string, serializedResponse: string): void {
    if (!this.responseByTaskId.has(taskId)) {
      this.responseByTaskId.set(taskId, serializedResponse);
      this.persist();
    }
  }

  get size(): number {
    return this.seenProofTx.size;
  }
}

export function normalizeTx(tx: string): string {
  return (tx ?? "").trim().toLowerCase();
}
