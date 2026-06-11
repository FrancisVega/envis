import { serve } from "@hono/node-server";
import { createApp } from "./app";

// Backend para desarrollo: Vite (puerto 5173) redirige /api aquí.
const port = 5179;
serve({ fetch: createApp({ currentDir: process.cwd() }).fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`envis API (dev) ▸ http://127.0.0.1:${port}`);
});
