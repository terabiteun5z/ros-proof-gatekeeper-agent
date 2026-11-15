import { createAgentServer } from "./local-server";

/**
 * Vercel backends entrypoint: the platform expects a default export that is
 * a function or an http.Server. The server is created but NOT listened here;
 * the hosting runtime assigns the port. Local runs use src/local-server.ts
 * via `npm run dev` / `npm run serve`.
 */
const server = createAgentServer();

export default server;
