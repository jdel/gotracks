import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { FormScreen, Input, Sheet } from "./primitives";
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  // Deferred until the sheet has arrived, so `waitFor` rather than a straight
  // assertion: focusing raises the keyboard, and a keyboard raised mid-flight
  // leaves the browser scrolling to where the field was.
  it("focuses the first field where there is a real keyboard", async () => {
    setViewport("desktop");
    openSheet();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Description")),
    );
  });

  // It focuses on a phone too. This used to be skipped there, on the grounds
  // that the keyboard would cover the sheet — which was true while the sheet
  // was pinned to the bottom of the screen, and is fixed at the source above.
  // Skipping it left the add sheet with no focus at all: you tapped +, and then
  // had to tap again to start typing.
  it("focuses it on a touch pointer too", async () => {
    setViewport("phone");
    openSheet();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Description")),
    );
  });

  // Nothing to wait for when the animation is off, so it lands at once.
  it("focuses immediately when motion is reduced", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    openSheet();

    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
  });
});

describe("what a full-screen form focuses when it opens", () => {
  it("focuses and refreshes the marked description after the complete form mounts", async () => {
    setViewport("phone");
    const userAgent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const focused = vi.fn();
    const primed = vi.fn();
    render(
      <FormScreen open onClose={() => {}} title="Edit action" closeLabel="Close">
        <form>
          <Input data-form-primary aria-label="Description" onFocus={focused} />
          <Input aria-label="Tags" onFocus={primed} />
        </form>
      </FormScreen>,
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Description")),
    );
    await waitFor(() => expect(focused).toHaveBeenCalledTimes(2));
    expect(primed).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Description").closest("form")).not.toBeNull();
    userAgent.mockRestore();
  });
});
