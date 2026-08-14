import { describe, expect, it } from "vitest";
import { installZoomGuard } from "./zoom";

function gesture(target: EventTarget, type: string, scale: number) {
  const event = Object.assign(new Event(type, { cancelable: true }), { scale });
  target.dispatchEvent(event);
  return event;
}

function touchEnd(target: EventTarget, timeStamp: number) {
  const event = new Event("touchend", { cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: [{}] },
    timeStamp: { value: timeStamp },
  });
  target.dispatchEvent(event);
  return event;
}

describe("the iOS zoom guard", () => {
  it("blocks a pinch while the page is at normal scale", () => {
    const target = new EventTarget();
    installZoomGuard(target as Document, () => 1);

    expect(gesture(target, "gesturestart", 1).defaultPrevented).toBe(true);
    expect(gesture(target, "gesturechange", 1.2).defaultPrevented).toBe(true);
  });

  it("allows a page restored zoomed-in to be pinched back out", () => {
    const target = new EventTarget();
    installZoomGuard(target as Document, () => 2);

    expect(gesture(target, "gesturestart", 1).defaultPrevented).toBe(false);
    expect(gesture(target, "gesturechange", 0.8).defaultPrevented).toBe(false);
    expect(gesture(target, "gesturechange", 1.2).defaultPrevented).toBe(true);
  });

  it("blocks the second tap of a double tap", () => {
    const target = new EventTarget();
    installZoomGuard(target as Document, () => 1);

    expect(touchEnd(target, 100).defaultPrevented).toBe(false);
    expect(touchEnd(target, 300).defaultPrevented).toBe(true);
  });
});
