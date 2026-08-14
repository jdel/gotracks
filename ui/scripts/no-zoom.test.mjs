import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The app must not zoom on a phone. Three separate mechanisms have to agree,
 * none of them visible in a rendered component: a real device was the only
 * place the failure showed up, which is why they are pinned here instead.
 *
 * Here rather than under `src/` because these read files from disk, and `src`
 * is browser code with no node types. The browser suite is no help either — it
 * drives desktop Chromium, and the behaviour being prevented is iOS Safari's.
 */

const root = join(import.meta.dirname, "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

/** A `export const name = "..." + "..."` class string, joined back together. */
function classString(source, name) {
  const declaration = source.match(new RegExp(`export const ${name} =([\\s\\S]*?);\\n`));
  expect(declaration, `${name} is not declared the way this test reads it`).toBeTruthy();
  return [...declaration[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
}

describe("the app does not zoom on a phone", () => {
  it("asks the browser not to scale the page", () => {
    const viewport = read("index.html").match(/<meta\s+name="viewport"[\s\S]*?content="([^"]+)"/);

    expect(viewport).toBeTruthy();
    expect(viewport[1]).toContain("maximum-scale=1.0");
    expect(viewport[1]).toContain("user-scalable=no");
    // The notch inset has to survive alongside them.
    expect(viewport[1]).toContain("viewport-fit=cover");
  });

  // Not a zoom rule, but it lives in the same tag: it asks Android to resize
  // the layout viewport when the keyboard opens, which is the half of the
  // keyboard fix that needs no JavaScript. iOS ignores it, hence
  // `useKeyboardInset`.
  it("asks the browser to resize for the keyboard", () => {
    const viewport = read("index.html").match(/<meta\s+name="viewport"[\s\S]*?content="([^"]+)"/);

    expect(viewport[1]).toContain("interactive-widget=resizes-content");
  });

  it("turns off the double-tap zoom", () => {
    expect(read("src/index.css")).toMatch(/body\s*{[^}]*touch-action:\s*manipulation/);
  });

  // iOS ignores the viewport meta above for one case: focusing a field whose
  // text is under 16px zooms the page to it, and then scrolls it out of view.
  // 16px on touch widths is the only thing that prevents it.
  it("gives the shared field 16px text below the desktop breakpoint", () => {
    const styles = read("src/components/primitive-styles.ts");
    const field = classString(styles, "inputClass");

    expect(field).toMatch(/(^|\s)text-base(\s|$)/);
    expect(field).toMatch(/(^|\s)md:text-sm(\s|$)/);
    expect(field, "14px is for the desktop breakpoint only").not.toMatch(/(^|\s)text-sm(\s|$)/);
  });

  it("keeps the rule wherever an inline editor sets its own size", () => {
    // These override the shared class, so they are the ones that can silently
    // drop back to 14px: the action title edited in its row, and a note's body.
    const overrides = ["src/components/TodoItem.tsx", "src/pages/NotesPage.tsx"].flatMap((file) =>
      [...read(file).matchAll(/cn\(\s*inlineEdit,\s*"([^"]*)"/gs)].map((m) => [file, m[1]]),
    );

    expect(overrides).toHaveLength(2);
    for (const [file, classes] of overrides) {
      expect(classes, `${file}: an inline editor under 16px zooms iOS on focus`).toMatch(
        /(^|\s)text-base(\s|$)/,
      );
      expect(classes, `${file}: 14px is for the desktop breakpoint only`).not.toMatch(
        /(^|\s)text-sm(\s|$)/,
      );
    }
  });
});
