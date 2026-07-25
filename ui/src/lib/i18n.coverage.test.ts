import { describe, expect, it } from "vitest";
import { availableLocales, en, locales } from "./i18n";

type Dict = typeof en;
const keys = Object.keys(en) as (keyof Dict)[];

/** The {placeholders} a string interpolates, as a sorted list. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("interface translations", () => {
  // Offering a language in the picker and then rendering half the interface in
  // English is worse than not offering it, so every listed locale has to be
  // complete.
  it.each(availableLocales.map(({ code, label }) => [code, label]))(
    "%s (%s) translates every key",
    (code) => {
      const dict = locales[code];
      expect(dict, `no dictionary for ${code}`).toBeDefined();
      const missing = keys.filter((key) => dict![key] === undefined);
      expect(missing, `${code} is missing ${missing.length} keys`).toEqual([]);
    },
  );

  // A translation that drops {count} or renames {email} loses the value at
  // runtime and reads as a literal brace, which no type check catches.
  it.each(availableLocales.map(({ code }) => code))(
    "%s keeps every interpolated value",
    (code) => {
      const dict = locales[code];
      const broken: string[] = [];
      for (const key of keys) {
        const translated = dict?.[key];
        if (translated === undefined) continue;
        const want = placeholders(en[key]);
        const got = placeholders(translated);
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          broken.push(`${key}: expected ${want.join()} got ${got.join()}`);
        }
      }
      expect(broken).toEqual([]);
    },
  );

  // The picker and the dictionaries are edited in different places; a language
  // present in one and not the other is a silent English fallback.
  it("lists exactly the locales it can render", () => {
    expect(Object.keys(locales).sort()).toEqual(
      availableLocales.map(({ code }) => code).sort(),
    );
  });
});
