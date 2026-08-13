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
    // One chunk: 753 kB raw, 222 kB gzipped as this build reports it, plus
    // 51 kB of CSS (10 kB gzipped). Gzip is the number that matters — it is
    // what the browser downloads — and the limit below counts raw bytes, which
    // is why it looks so much larger than the figure worth caring about.
    //
    // Measured 2026-08-13, route-level lazy loading of the nine secondary and
    // admin pages (admin, server settings, reports, audit, legal, stats,
    // recurring, attachments, notes): first load 224.9 kB → 215.3 kB gzipped.
    // (Both sides measured with gzip -9, which is a little tighter than the
    // figure printed above; the comparison is what matters, not the tool.)
    // Ten kilobytes, for a loading state on every one of those pages. Split by
    // vendor as well and the answer does not move: the weight is not in the
    // pages, it is in what every page needs.
    //
    // Where the 214 kB actually goes, gzipped:
    //   React + scheduler   57 kB   the floor, short of changing framework
    //   application code    73 kB
    //   Radix primitives    25 kB   dialogs, popovers, tooltips
    //   dnd-kit             14 kB   drag-to-reorder
    //   react-router        13 kB
    //   react-query         10 kB
    //   everything else     13 kB   lucide icons tree-shake to 4.5 kB
    //
    // So the honest conclusion is to leave the bundle alone and raise the
    // ceiling to a number that means something. 800 kB raw is roughly 10% of
    // headroom: enough that ordinary work does not trip it, little enough that
    // a new dependency of any size does. A warning that fires on every build is
    // worse than no warning, which is what 600 had become.
    //
    // This one still only warns, though — Vite has no size option that fails a
    // build. The ceiling that does is `scripts/bundle-budget.mjs`, on the gzip
    // figure, run at the end of `npm run build`. Without it the measurement
    // above ages into a comment that confidently states last year's number.
    chunkSizeWarningLimit: 800,
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
