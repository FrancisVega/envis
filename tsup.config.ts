import { defineConfig } from "tsup";

// Empaqueta el CLI (y el código de servidor/core que importa) en dist/cli.js.
// `hono`, `@hono/node-server` y `open` quedan externos (van en dependencies).
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node18",
  clean: true,
});
