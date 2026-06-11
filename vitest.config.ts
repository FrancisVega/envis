import { defineConfig } from "vitest/config";

// Config propia de tests para no heredar `root: "src/web"` de vite.config.ts
// (que es solo para construir el frontend). Los tests viven en core y server.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
