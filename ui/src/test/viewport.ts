import { vi } from "vitest";
import { DESKTOP_MIN_WIDTH } from "@/hooks/useMediaQuery";

/**
 * Says which viewport a test is about.
 *
 * jsdom implements no `matchMedia` at all, so without this a component that
 * chooses its presentation sees the fallback — a phone. Tests that assert
 * desktop behaviour have to say so; tests that assert phone behaviour are
 * clearer for saying so too.
 *
 * Installed with `vi.stubGlobal`, so an `afterEach` calling
 * `vi.unstubAllGlobals()` removes it along with everything else.
 */
export function setViewport(
  kind: "phone" | "desktop",
  {
    /**
     * Which pointer the device has. Width and pointer are separate questions —
     * a tablet is as wide as a laptop and has no mouse — so a test can say so,
     * but the default is the honest pairing.
     */
    pointer = kind === "desktop" ? "fine" : "coarse",
  }: { pointer?: "fine" | "coarse" } = {},
) {
  const width = kind === "desktop" ? DESKTOP_MIN_WIDTH : DESKTOP_MIN_WIDTH - 1;
  vi.stubGlobal("matchMedia", (query: string) => {
    // Only min-width and pointer are interpreted, which is all the app asks
    // about. Anything else answers false rather than pretending to know.
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    const wantPointer = /\(pointer:\s*(fine|coarse)\)/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : wantPointer ? wantPointer[1] === pointer : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
}
