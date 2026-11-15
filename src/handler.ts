import type { Config } from "./config";
import { deriveSalt, signBody, verifyBodySignature } from "./hmac";
import { buildCircuitInputs, evaluate, parseInput } from "./decision";
import { Prover } from "./prover";
import { submitProofAndPoll } from "./kurier";
import { SeenStore } from "./seenStore";
import {
  PREFLIGHT_TYPE,
  PROTOCOL_VERSION,
  TASK_TYPE,
  type PreflightResponse,
  type TaskEnvelope,
  type TaskResponse,
} from "./types";

/**
 * Framework-agnostic request handling shared by the local server
 * (src/local-server.ts) and the Vercel function (api/agent.ts).
 *
 * Pipeline (per /build):
 *   1. HMAC over the RAW body vs x-agent-games-signature — before JSON parsing.
 *   2. Preflight (type = agent-games.preflight.v1) -> signed { ok, protocolVersion }.
 *   3. Task: validate envelope + timestamps, deterministic policy evaluation,
 *      local Groth16 proof (except PROOF_REUSED), optional Kurier submission,
 *      signed response. Any error or uncertainty fails closed to REJECT.
 */
export interface HandlerResult {
  status: number;
  body: string;
  /** Value for the x-agent-games-signature response header (null = do not send). */
  signature: string | null;
}

export class AgentHandler {
  private prover: Prover;

  constructor(
    private cfg: Config,
    private store: SeenStore,
  ) {
    this.prover = new Prover(cfg.circuitsDir);
  }

  health(): HandlerResult {
    const body = JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION });
    return { status: 200, body, signature: null };
  }

  async handlePost(
    rawBody: Buffer,
    signatureHeader: string | undefined | null,
  ): Promise<HandlerResult> {
    const startedAt = Date.now();

    if (!this.cfg.hmacSecret) {
      return {
        status: 500,
        body: JSON.stringify({ error: "server_misconfigured", detail: "AGENT_GAMES_HMAC_SECRET not set" }),
        signature: null,
      };
    }

    // 1. Authenticate the raw body BEFORE parsing.
    if (!verifyBodySignature(this.cfg.hmacSecret, rawBody, signatureHeader)) {
      return {
        status: 401,
        body: JSON.stringify({ error: "invalid_signature" }),
        signature: null,
      };
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return this.signed(400, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }

    // 2. Preflight handshake.
    if (envelope.type === PREFLIGHT_TYPE) {
      const body: PreflightResponse = { ok: true, protocolVersion: PROTOCOL_VERSION };
      return this.signed(200, body);
    }

    if (envelope.type !== TASK_TYPE) {
      return this.signed(400, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }

    // 3. Task.
    const task = envelope as unknown as TaskEnvelope;
    try {
      return await this.handleTask(task, startedAt);
    } catch (err) {
      // Fail closed: never approve on an internal error.
      console.error("[agent] task handling error:", (err as Error).message);
      return this.signed(200, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }
  }

  private async handleTask(task: TaskEnvelope, startedAt: number): Promise<HandlerResult> {
    // Idempotent redelivery: answer from the cache, never re-evaluate
    // (a redelivery must not be mistaken for proof reuse).
    if (task.task_id) {
      const cached = this.store.getResponse(task.task_id);
      if (cached) return this.signedRaw(200, cached);
    }

    // Timestamp / deadline sanity (HMAC already authenticates the sender;
    // this is anti-replay hygiene). Unparseable timestamps are logged, not
    // fatal — only a clearly-past deadline fails the task.
    const now = Date.now();
    const deadlineMs = parseTimestamp(task.deadline_at);
    const issuedMs = parseTimestamp(task.issued_at);
    if (deadlineMs !== null && now > deadlineMs) {
      return this.signed(200, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }
    if (issuedMs !== null && issuedMs > now + 5 * 60_000) {
      return this.signed(200, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }

    const parsed = parseInput(task.input);
    if (!parsed || !task.task_id) {
      return this.signed(200, { decision: "REJECT", reason_code: "INVALID_TASK" });
    }

    const evaluation = evaluate(parsed, (tx) => this.store.hasProofTx(tx));

    const response: TaskResponse = {
      decision: evaluation.decision,
      reason_code: evaluation.reason_code,
    };

    if (evaluation.provable) {
      const salt = deriveSalt(this.cfg.hmacSecret, task.task_id);
      const circuitInputs = buildCircuitInputs(task, parsed, evaluation.decision, salt);
      try {
        const { proof, publicSignals } = await this.prover.prove(circuitInputs);
        response.proof = proof;
        response.public_signals = publicSignals;

        // zkVerify submission via Kurier, bounded so the response stays well
        // inside the 60s deadline. Never blocks the answer on finalization:
        // on budget expiry we still return the proof + public_signals.
        const remaining =
          this.cfg.taskSoftDeadlineMs - (Date.now() - startedAt);
        const budget = Math.min(this.cfg.kurierPollBudgetMs, Math.max(0, remaining));
        const kurier = await submitProofAndPoll(this.cfg, proof, publicSignals, budget);
        response.proof_tx = kurier?.txHash ? kurier.txHash : parsed.proofTx;
      } catch (err) {
        // Proving failed: fail closed. A claimed APPROVE without a valid
        // proof is the worst outcome, so downgrade to REJECT with no proof.
        console.error("[agent] proof generation failed:", (err as Error).message);
        return this.signed(200, {
          decision: "REJECT",
          reason_code: evaluation.decision === "APPROVE" ? "INVALID_TASK" : evaluation.reason_code,
          proof_tx: parsed.proofTx,
        });
      }
    } else {
      // PROOF_REUSED: documented as having no proof to submit; echo the
      // reference, matching the sample response shape on /build.
      response.proof_tx = parsed.proofTx;
    }

    const result = this.signed(200, response);
    // Record only after a successful evaluation, so a task never flags itself.
    this.store.recordProofTx(parsed.proofTx);
    this.store.recordResponse(task.task_id, result.body);
    return result;
  }

  private signed(status: number, obj: unknown): HandlerResult {
    return this.signedRaw(status, JSON.stringify(obj));
  }

  private signedRaw(status: number, body: string): HandlerResult {
    return { status, body, signature: signBody(this.cfg.hmacSecret, body) };
  }
}

/** Tolerant timestamp parse: ISO string, epoch seconds, or epoch ms. */
export function parseTimestamp(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const asNum = Number(v);
    if (/^[0-9]+$/.test(v.trim()) && Number.isFinite(asNum)) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
