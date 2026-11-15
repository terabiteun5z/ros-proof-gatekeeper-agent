import * as http from "http";
import { loadConfig } from "./config";
import { AgentHandler } from "./handler";
import { SeenStore } from "./seenStore";
import { SIGNATURE_HEADER } from "./types";

/**
 * Plain Node HTTP server for local runs and non-serverless hosting.
 * Routes:
 *   POST /agent   — the registered agent endpoint (tasks + preflight)
 *   GET  /agent   — health check { ok: true, protocolVersion: "v1" }
 *   GET  /health  — same health payload
 */
const MAX_BODY_BYTES = 1_048_576;

export function createAgentServer(): http.Server {
  const cfg = loadConfig();
  if (!cfg.hmacSecret) {
    console.warn(
      "[agent] WARNING: AGENT_GAMES_HMAC_SECRET is not set — POSTs will fail with 500 until it is.",
    );
  }
  const handler = new AgentHandler(cfg, new SeenStore(cfg.seenStorePath));

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isAgentPath = url.pathname === "/agent" || url.pathname === "/";

    if (req.method === "GET" && (isAgentPath || url.pathname === "/health")) {
      const r = handler.health();
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.body);
      return;
    }

    if (req.method === "POST" && isAgentPath) {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "payload_too_large" }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", async () => {
        const rawBody = Buffer.concat(chunks);
        const signature = req.headers[SIGNATURE_HEADER];
        const result = await handler.handlePost(
          rawBody,
          Array.isArray(signature) ? signature[0] : signature,
        );
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (result.signature) headers[SIGNATURE_HEADER] = result.signature;
        res.writeHead(result.status, headers);
        res.end(result.body);
      });
      req.on("error", () => {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

if (require.main === module) {
  const cfg = loadConfig();
  const server = createAgentServer();
  server.listen(cfg.port, () => {
    console.log(`[agent] Proof Gatekeeper listening on :${cfg.port} (POST /agent)`);
  });
}
