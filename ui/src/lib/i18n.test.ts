import { describe, expect, it } from "vitest";
import { en, fr } from "./i18n";

describe("translations", () => {
  // The goal is no hardcoded language: every English key must have a French
  // translation, or that string silently falls back to English at runtime.
  it("french covers every english key", () => {
    const missing = Object.keys(en).filter((k) => !(k in fr));
    expect(missing, `missing French translations: ${missing.join(", ")}`).toEqual([]);
  });

  // A stray French-only key is a typo that will never be reached.
  it("has no french keys absent from english", () => {
    const extra = Object.keys(fr).filter((k) => !(k in en));
    expect(extra, `French keys not in English: ${extra.join(", ")}`).toEqual([]);
  });

  // Placeholders must line up, or one language interpolates a value the other
  // drops on the floor.
  it("keeps the same placeholders in both languages", () => {
    const holders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    const mismatched = Object.keys(en).filter(
      (k) => k in fr && holders(en[k as keyof typeof en]) !== holders(fr[k as keyof typeof fr]!),
    );
    expect(mismatched, `placeholder mismatch: ${mismatched.join(", ")}`).toEqual([]);
  });
});
