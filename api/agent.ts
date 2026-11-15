import { loadConfig } from "../src/config";
import { AgentHandler } from "../src/handler";
import { SeenStore } from "../src/seenStore";
import { SIGNATURE_HEADER } from "../src/types";

/**
 * Vercel serverless entry for the Proof Gatekeeper agent.
 *
 * Serves POST /agent (tasks + preflight) and GET /agent (health check).
 * `bodyParser: false` is essential: the HMAC must be verified over the
 * RAW request body before any JSON parsing, exactly like src/local-server.ts.
 *
 * This file was missing from the public reference scaffold (its README and
 * tsconfig both reference api/agent.ts); it mirrors the local server's
 * routing and delegates every decision to the shared AgentHandler, so the
 * local harness (npm test) and the deployed function behave identically.
 *
 * Env: AGENT_GAMES_HMAC_SECRET (required), KURIER_API_KEY (optional).
 * On Vercel the seen-set lives in /tmp (see src/config.ts).
 */

export const config = {
  api: { bodyParser: false },
};

const cfg = loadConfig();
const handler = new AgentHandler(cfg, new SeenStore(cfg.seenStorePath));

const MAX_BODY_BYTES = 1_048_576;

type MinimalReq = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", cb: (chunk: Buffer) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: () => void): void;
};

type MinimalRes = {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
  headersSent?: boolean;
};

export default function agent(req: MinimalReq, res: MinimalRes): void {
  if (req.method === "GET") {
    const r = handler.health();
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(r.body);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    void (async () => {
      const rawBody = Buffer.concat(chunks);
      const sig = req.headers[SIGNATURE_HEADER];
      const result = await handler.handlePost(
        rawBody,
        Array.isArray(sig) ? sig[0] : sig,
      );
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (result.signature) headers[SIGNATURE_HEADER] = result.signature;
      res.writeHead(result.status, headers);
      res.end(result.body);
    })();
  });
  req.on("error", () => {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  });
}
