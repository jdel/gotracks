import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Input, Sheet } from "./primitives";
import { setViewport } from "@/test/viewport";

/**
 * What a sheet does when the on-screen keyboard opens.
 *
 * The failure this covers was only visible on a real phone: iOS draws the
 * keyboard over the layout viewport instead of resizing it, so a sheet pinned
 * to `bottom: 0` sits behind it, and the field the sheet focused on opening is
 * off screen while you type into it.
 */

function stubViewport(height: number, innerHeight = 800) {
  const listeners = new Set<() => void>();
  vi.stubGlobal("innerHeight", innerHeight);
  vi.stubGlobal("visualViewport", {
    height: innerHeight,
    offsetTop: 0,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  });
  return (next = height) => {
    Object.assign(window.visualViewport!, { height: next });
    act(() => listeners.forEach((fn) => fn()));
  };
}

function openSheet() {
  return render(
    <Sheet open onClose={() => {}} title="Add an action">
      <Input aria-label="Description" />
      <button type="button">Save</button>
    </Sheet>,
  );
}

const panel = () => screen.getByRole("dialog");

afterEach(() => vi.unstubAllGlobals());

describe("a sheet and the on-screen keyboard", () => {
  it("sits on the bottom edge while no keyboard is up", () => {
    stubViewport(800);
    openSheet();

    // Nothing inline: the class keeps it at the bottom, 85dvh tall.
    expect(panel().style.bottom).toBe("");
    expect(panel().style.maxHeight).toBe("");
  });

  it("lifts to sit on top of the keyboard, and caps itself to what is left", () => {
    const openKeyboard = stubViewport(460);
    openSheet();

    openKeyboard();

    expect(panel().style.bottom).toBe("340px");
    expect(panel().style.maxHeight).toBe("calc(100dvh - 340px)");
  });

  it("comes back down when the keyboard closes", () => {
    const openKeyboard = stubViewport(460);
    openSheet();
    openKeyboard();

    openKeyboard(800);

    expect(panel().style.bottom).toBe("");
  });
});

describe("what a sheet focuses when it opens", () => {
  it("focuses the first field where there is a real keyboard", () => {
    setViewport("desktop");
    openSheet();

    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });

  // Focusing a field on a phone summons the keyboard over a sheet that is still
  // animating up, and the browser then scrolls to where the field was a frame
  // ago. The tap that follows opens the keyboard with everything in place.
  it("leaves the keyboard shut on a touch pointer", () => {
    setViewport("phone");
    openSheet();

    expect(document.activeElement).not.toBe(screen.getByLabelText("Description"));
    // Focus is still inside the sheet, so Tab enters it and it is announced.
    expect(panel().contains(document.activeElement)).toBe(true);
  });
});
