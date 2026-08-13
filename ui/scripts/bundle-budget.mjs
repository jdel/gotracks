// Fails the build when the entry chunk crosses a ceiling.
//
// `chunkSizeWarningLimit` in vite.config.ts only warns, and a warning printed
// on a build nobody watches is not a limit. This is the same idea with teeth:
// over the line, the build stops.
//
// Gzip, because that is what the browser downloads — the same figure the
// splitting decision in vite.config.ts was argued on.
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 215 kB today; ~10% of headroom, the same margin the raw warning limit uses. */
export const MAX_ENTRY_GZIP = 235 * 1024;

/**
 * The built entry script, found the way a browser finds it.
 *
 * Not by globbing `assets/index-*.js`: the name carries a content hash that
 * changes every build, so a pattern that stops matching would report nothing to
 * check and pass. index.html is the one file whose name is fixed, and it points
 * at whatever the build just produced.
 */
export function entryScript(distDir) {
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
  if (!match) {
    throw new Error(
      `no module script in ${join(distDir, "index.html")} — if the build output ` +
        `changed shape, this budget stopped measuring anything and needs fixing`,
    );
  }
  return join(distDir, match[1].replace(/^\//, ""));
}

/** Gzipped size of the entry chunk, in bytes. */
export function entryGzipSize(distDir) {
  return gzipSync(readFileSync(entryScript(distDir)), { level: 9 }).length;
}

const kB = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

/** Returns the report and whether it passed, so the test can assert on both. */
export function check(distDir, max = MAX_ENTRY_GZIP) {
  const size = entryGzipSize(distDir);
  return {
    ok: size <= max,
    size,
    message: `entry chunk ${kB(size)} gzipped, budget ${kB(max)}`,
  };
}

// Run directly (as `npm run build` does) rather than imported by the test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = resolve(here, "..", "..", "internal", "web", "dist");
  const { ok, message } = check(dist);
  if (!ok) {
    console.error(
      `\nBundle over budget: ${message}.\n` +
        `Adding this much at once is a decision, not an accident: either take the ` +
        `weight back out, or raise MAX_ENTRY_GZIP in scripts/bundle-budget.mjs and ` +
        `say in the commit what earned it.\n`,
    );
    process.exit(1);
  }
  console.log(`Bundle within budget: ${message}.`);
}
