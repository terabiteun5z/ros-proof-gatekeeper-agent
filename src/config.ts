import * as fs from "fs";
import * as path from "path";

/**
 * Runtime configuration, all from environment variables.
 * No secret has a default value; the HMAC secret must come from the platform
 * dashboard ("Rotate Secret") via AGENT_GAMES_HMAC_SECRET.
 */
export interface Config {
  hmacSecret: string;
  kurierApiKey: string | null;
  kurierApiUrl: string;
  /** Registered gatekeeper vk_hash on zkVerify mainnet (from /build, /api/circuit-info). */
  gatekeeperVkHash: string;
  circuitsDir: string;
  seenStorePath: string;
  /** Stop polling Kurier after this long; the response must stay well under the 60s deadline. */
  kurierPollBudgetMs: number;
  kurierPollIntervalMs: number;
  /** Soft internal deadline for the whole task handler. */
  taskSoftDeadlineMs: number;
  port: number;
}

function defaultCircuitsDir(): string {
  // <project>/circuits, resolved relative to this file in both src/ (tsx) and dist/ layouts.
  const candidates = [
    path.resolve(__dirname, "..", "circuits"),
    path.resolve(__dirname, "..", "..", "circuits"),
    path.resolve(process.cwd(), "circuits"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "gatekeeper.wasm"))) return c;
  }
  return candidates[0];
}

function defaultSeenStorePath(): string {
  // Vercel serverless filesystems are read-only except /tmp.
  if (process.env.VERCEL) return "/tmp/gatekeeper-seen.json";
  return path.resolve(process.cwd(), "data", "seen.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    hmacSecret: env.AGENT_GAMES_HMAC_SECRET ?? "",
    kurierApiKey: env.KURIER_API_KEY ? env.KURIER_API_KEY : null,
    kurierApiUrl: env.KURIER_API_URL ?? "https://api.kurier.xyz/api/v1",
    gatekeeperVkHash:
      env.GATEKEEPER_VK_HASH ??
      "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
    circuitsDir: env.CIRCUITS_DIR ?? defaultCircuitsDir(),
    seenStorePath: env.SEEN_STORE_PATH ?? defaultSeenStorePath(),
    kurierPollBudgetMs: Number(env.KURIER_POLL_BUDGET_MS ?? 15_000),
    kurierPollIntervalMs: Number(env.KURIER_POLL_INTERVAL_MS ?? 3_000),
    taskSoftDeadlineMs: Number(env.TASK_SOFT_DEADLINE_MS ?? 50_000),
    port: Number(env.PORT ?? 8787),
  };
}
