/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Build output goes into the Go embed package so the binary can serve the SPA.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
    // The bundle is ~520 kB, and about 45% of that is React itself. Splitting
    // it was measured and moved only 6 kB of gzipped weight off the first load,
    // so the default 500 kB warning is just noise here. Raised rather than
    // silenced, so a genuine jump still gets flagged.
    chunkSizeWarningLimit: 600,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
