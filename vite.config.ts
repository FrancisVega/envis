import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// El frontend se empaqueta en un único index.html auto-contenido (JS + CSS
// inline) para que el CLI solo tenga que servir un fichero, sin gestionar
// assets sueltos. En desarrollo, /api se redirige al backend (dev.ts).
export default defineConfig({
  root: "src/web",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:5179" },
  },
});
