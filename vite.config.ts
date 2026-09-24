import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: "apps/web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve("apps/web/src") } },
  build: { assetsInlineLimit: 0, outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3210", changeOrigin: true } },
  },
});
