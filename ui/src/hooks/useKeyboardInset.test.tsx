import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useKeyboardInset } from "./useKeyboardInset";

/**
 * jsdom has no `visualViewport`, and Playwright cannot raise a virtual
 * keyboard, so no suite can prove what this looks like on a phone. What is
 * provable is the arithmetic — which strip is considered covered, and when a
 * gap is a keyboard rather than a collapsing address bar. The device remains
 * the judge of the result.
 */

/** A visual viewport of `height`, with the page scrolled up by `offsetTop`. */
function stubViewport({
  height,
  offsetTop = 0,
  innerHeight = 800,
}: {
  height: number;
  offsetTop?: number;
  innerHeight?: number;
}) {
  const listeners = new Set<() => void>();
  vi.stubGlobal("innerHeight", innerHeight);
  vi.stubGlobal("visualViewport", {
    height,
    offsetTop,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  });
  return {
    /** What the browser does when the keyboard opens: resize, then notify. */
    resizeTo(next: number, top = 0) {
      Object.assign(window.visualViewport!, { height: next, offsetTop: top });
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

function Probe() {
  return <span data-testid="inset">{useKeyboardInset()}</span>;
}

const inset = () => screen.getByTestId("inset").textContent;

afterEach(() => vi.unstubAllGlobals());

describe("the keyboard inset", () => {
  it("is nothing when no keyboard is up", () => {
    stubViewport({ height: 800 });
    render(<Probe />);

    expect(inset()).toBe("0");
  });

  it("measures the strip the keyboard covers", () => {
    const viewport = stubViewport({ height: 800 });
    render(<Probe />);

    viewport.resizeTo(460);

    expect(inset()).toBe("340");
  });

  it("counts the scroll the browser did to reveal the field", () => {
    const viewport = stubViewport({ height: 800 });
    render(<Probe />);

    // 460 tall and pushed up by 40: the covered strip is 800 - (460 + 40).
    viewport.resizeTo(460, 40);

    expect(inset()).toBe("300");
  });

  // An address bar collapsing moves the visual viewport by a few dozen pixels.
  // Lifting the sheet for that would be a twitch, and no keyboard is that small.
  it("ignores a gap too small to be a keyboard", () => {
    const viewport = stubViewport({ height: 800 });
    render(<Probe />);

    viewport.resizeTo(740);

    expect(inset()).toBe("0");
  });

  it("reads nothing where the browser has no visual viewport", () => {
    vi.stubGlobal("visualViewport", undefined);
    render(<Probe />);

    expect(inset()).toBe("0");
  });
});
