import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, entryScript } from "./bundle-budget.mjs";

/**
 * The budget guards the bundle; this guards the budget.
 *
 * A size check that quietly stops finding the file it is meant to weigh reports
 * nothing wrong, forever — which is indistinguishable from a bundle that never
 * grew. So the case that matters most here is the third one.
 */

const dirs = [];

function aBuild({ html, bytes = 10 }) {
  const dist = mkdtempSync(join(tmpdir(), "budget-"));
  dirs.push(dist);
  mkdirSync(join(dist, "assets"));
  // Incompressible on purpose: gzip flattens anything with a pattern to almost
  // nothing, and then "200 kB of JavaScript" would weigh a few hundred bytes
  // here and the sizes in this test would mean nothing.
  const filler = randomBytes(bytes);
  writeFileSync(join(dist, "assets", "index-a1b2c3.js"), filler);
  writeFileSync(join(dist, "index.html"), html);
  return dist;
}

const realistic = `<!doctype html><html><head>
  <script type="module" crossorigin src="/assets/index-a1b2c3.js"></script>
  <link rel="stylesheet" href="/assets/index-d4e5f6.css">
</head><body><div id="root"></div></body></html>`;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the bundle budget", () => {
  it("passes a bundle under the line", () => {
    const result = check(aBuild({ html: realistic, bytes: 1024 }), 100 * 1024);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("budget 100.0 kB");
  });

  it("fails a bundle over it", () => {
    const result = check(aBuild({ html: realistic, bytes: 200 * 1024 }), 10 * 1024);

    expect(result.ok).toBe(false);
    // The size is reported, not just the verdict: "too big" without a number
    // leaves you running the build twice to find out by how much.
    expect(result.message).toMatch(/entry chunk \d+\.\d kB gzipped/);
  });

  // What a change in Vite's output shape looks like from here. It has to be
  // loud: a check that silently measures nothing always passes.
  it("refuses to pass when it cannot find the entry script", () => {
    const dist = aBuild({ html: `<!doctype html><html><head></head><body></body></html>` });

    expect(() => check(dist)).toThrow(/no module script/);
  });

  it("follows index.html rather than guessing the hashed name", () => {
    const dist = aBuild({
      html: `<!doctype html><html><head>
        <script type="module" src="/assets/index-a1b2c3.js"></script>
      </head></html>`,
    });

    expect(entryScript(dist)).toBe(join(dist, "assets", "index-a1b2c3.js"));
  });
});
