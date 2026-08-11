import { describe, expect, it } from "vitest";
import { addDays, changedDates, clampShowFrom, daysBetween, shiftShowFrom } from "./actionDates";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("crosses a year boundary backwards", () => {
    expect(addDays("2026-01-02", -7)).toBe("2025-12-26");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("leaves a blank date blank", () => {
    expect(addDays("", 7)).toBe("");
  });
});

describe("daysBetween", () => {
  it("counts forwards", () => {
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
  });

  it("counts backwards as negative", () => {
    expect(daysBetween("2026-03-15", "2026-03-01")).toBe(-14);
  });

  // The arithmetic is done in UTC precisely so a clock change cannot make a
  // day come out as 23 or 25 hours and round to the wrong number.
  it("is unaffected by a daylight-saving change", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

// Moving the due date carries the show-from with it, keeping the gap.
describe("shiftShowFrom", () => {
  it("keeps the interval when the due date moves out", () => {
    expect(shiftShowFrom("2000-02-01", "2000-02-15", "2000-01-01")).toBe("2000-01-15");
  });

  it("keeps the interval when the due date moves back", () => {
    expect(shiftShowFrom("2026-06-20", "2026-06-10", "2026-06-13")).toBe("2026-06-03");
  });

  // Nothing is invented for an action that never had a show-from: the default
  // is a creation-time rule and an edit must not start deferring things.
  it("leaves a blank show-from blank", () => {
    expect(shiftShowFrom("2026-06-20", "2026-07-20", "")).toBe("");
  });

  it("leaves the show-from alone when there was no due date to move from", () => {
    expect(shiftShowFrom("", "2026-07-20", "2026-06-01")).toBe("2026-06-01");
  });
});

describe("clampShowFrom", () => {
  it("pulls a show-from after the due date back to it", () => {
    expect(clampShowFrom("2026-05-10", "2026-05-20")).toBe("2026-05-10");
  });

  it("leaves an earlier show-from untouched", () => {
    expect(clampShowFrom("2026-05-10", "2026-05-01")).toBe("2026-05-01");
  });

  // Without a due date there is nothing to clamp against — parking an undated
  // action arbitrarily far ahead is legitimate.
  it("does not constrain an action with no due date", () => {
    expect(clampShowFrom("", "2027-01-01")).toBe("2027-01-01");
  });
});

// An empty string tells the API to clear a date, so an edit that sends both
// fields clears the one nobody touched. Setting a due date used to wipe the
// action's show-from that way.
describe("changedDates", () => {
  it("sends only the field that moved", () => {
    expect(changedDates({ due: "", showFrom: "2026-01-01" }, { due: "2026-02-01", showFrom: "2026-01-01" }))
      .toEqual({ due: "2026-02-01" });
  });

  it("sends both when both moved, as the gap rule makes them", () => {
    expect(changedDates({ due: "2026-02-01", showFrom: "2026-01-01" }, { due: "2026-02-15", showFrom: "2026-01-15" }))
      .toEqual({ due: "2026-02-15", showFrom: "2026-01-15" });
  });

  it("sends an empty string when a date really is being cleared", () => {
    expect(changedDates({ due: "2026-02-01", showFrom: "" }, { due: "", showFrom: "" }))
      .toEqual({ due: "" });
  });

  it("sends nothing at all when nothing moved", () => {
    expect(changedDates({ due: "2026-02-01", showFrom: "" }, { due: "2026-02-01", showFrom: "" })).toEqual({});
  });
});
