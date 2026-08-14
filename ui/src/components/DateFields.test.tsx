import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DateFields } from "./DateFields";
import type { ActionDates } from "./DateFields";

function renderFields(value: ActionDates, onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DateFields value={value} onChange={onChange} idPrefix="test" />
    </QueryClientProvider>,
  );
  return onChange;
}

function chooseDate(label: string, value: string) {
  const [year, month] = value.split("-");
  fireEvent.click(screen.getByLabelText(label));
  const picker = screen.getByRole("dialog", { name: label });
  fireEvent.change(within(picker).getByLabelText("Year"), { target: { value: year } });
  fireEvent.change(within(picker).getByLabelText("Month"), {
    target: { value: String(Number(month) - 1) },
  });
  fireEvent.click(within(picker).getByRole("button", { name: value }));
  fireEvent.click(within(picker).getByRole("button", { name: "Apply" }));
}

describe("the due and show-from pair", () => {
  // The gap between the two dates is what the user arranged; moving the
  // deadline should not silently change how much warning they get.
  it("carries the show-from along when the due date moves, keeping the gap", () => {
    const onChange = renderFields({ due: "2000-02-01", showFrom: "2000-01-01" });

    chooseDate("Due", "2000-02-15");

    expect(onChange).toHaveBeenCalledWith({ due: "2000-02-15", showFrom: "2000-01-15" });
  });

  // An action may not hide past the day it is due — the same rule the server
  // enforces, applied here so the field shows what will be stored.
  it("does not offer a show-from after the due date", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "" });

    fireEvent.click(screen.getByLabelText("Show from"));
    const picker = screen.getByRole("dialog", { name: "Show from" });
    fireEvent.change(within(picker).getByLabelText("Year"), { target: { value: "2026" } });
    fireEvent.change(within(picker).getByLabelText("Month"), { target: { value: "4" } });

    expect(within(picker).getByRole("button", { name: "2026-05-20" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sets the show-from a week before the due date from its quick-set", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "" });

    fireEvent.click(screen.getByRole("button", { name: "1 week before" }));

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-03" });
  });

  // "1 week before" needs something to be before. Anchoring it to today
  // instead would quietly turn it into "in 1 week".
  it("disables the show-from quick-sets while there is no due date", () => {
    renderFields({ due: "", showFrom: "" });

    expect(screen.getByRole("button", { name: "1 week before" })).toHaveProperty("disabled", true);
  });

  // A show-from is how long before its deadline an action appears, so there has
  // to be a deadline for it to be before. The field is disabled without one,
  // like its quick-sets already were.
  //
  // Asserted on the property, not by firing an event at it: jsdom dispatches
  // events at a disabled input quite happily, so a test that typed into it
  // would pass whether or not the rule existed.
  it("refuses a show-from while there is no due date", () => {
    renderFields({ due: "", showFrom: "" });

    expect(screen.getByLabelText("Show from")).toHaveProperty("disabled", true);
  });

  it("allows one as soon as there is a due date", () => {
    renderFields({ due: "2026-05-10", showFrom: "" });

    expect(screen.getByLabelText("Show from")).toHaveProperty("disabled", false);
  });

  // This used to assert the opposite — that the show-from stayed — while the
  // FAQ said it was cleared. The show-from was derived from the due date or
  // dragged along by it, so leaving it behind parks the action in the tickler
  // with nothing on screen to explain why.
  it("clears the show-from along with the due date", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "2026-05-01" });

    fireEvent.click(screen.getByLabelText("Clear the due date"));

    expect(onChange).toHaveBeenCalledWith({ due: "", showFrom: "" });
  });

  // Actions stored before this rule can have a show-from and no due date. The
  // field is disabled for them too, but the button beside it still works —
  // otherwise the action sits in the tickler with no way out of it from here.
  it("still clears a show-from left over from before the rule", () => {
    const onChange = renderFields({ due: "", showFrom: "2027-03-01" });

    expect(screen.getByLabelText("Show from")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("Clear the show-from date"));

    expect(onChange).toHaveBeenCalledWith({ due: "", showFrom: "" });
  });
});

describe("the calendar's commit boundary", () => {
  it("keeps the date in iOS form navigation without using its native wheel", () => {
    renderFields({ due: "", showFrom: "" });
    const due = screen.getByLabelText("Due");

    expect(due.tagName).toBe("INPUT");
    expect(due).toHaveProperty("type", "text");
    expect(due).toHaveProperty("readOnly", false);
    expect(due).toHaveProperty("inputMode", "text");
  });

  it("opens a compact floating calendar", () => {
    renderFields({ due: "", showFrom: "" });
    fireEvent.click(screen.getByLabelText("Due"));

    const picker = screen.getByRole("dialog", { name: "Due" });
    expect(picker.className).toContain("top-1/2");
    expect(picker.className).toContain("max-w-[22rem]");
    expect(picker.className).toContain("rounded-[24px]");
    expect(picker.className).not.toContain("inset-0");
  });

  it("accepts a typed date with slash separators", () => {
    const onChange = renderFields({ due: "", showFrom: "" });
    const due = screen.getByLabelText("Due");

    fireEvent.focus(due);
    fireEvent.change(due, { target: { value: "2026/09/24" } });
    fireEvent.blur(due);

    expect(onChange).toHaveBeenCalledWith({ due: "2026-09-24", showFrom: "2026-09-24" });
  });

  it("does not populate an empty date when the picker is cancelled", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    fireEvent.click(screen.getByLabelText("Due"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Due" })).getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Due")).toHaveProperty("value", "");
  });

  it("commits only when Apply is pressed", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    chooseDate("Due", "2026-09-24");

    expect(onChange).toHaveBeenCalledTimes(1);
    // The show-from comes with it: at the default lead of 0 days that is the
    // due date itself, which is what the server would have stored anyway.
    expect(onChange).toHaveBeenCalledWith({ due: "2026-09-24", showFrom: "2026-09-24" });
  });

  // The quick-sets are a single deliberate tap, so they save at once.
  it("commits a quick-set immediately", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "" });

    fireEvent.click(screen.getByRole("button", { name: "1 day before" }));

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-09" });
  });
});

// An action with a due date always has a show-from, so setting one fills the
// other in. The server would do it on save regardless; deriving it here means
// the field shows the date instead of appearing empty until the round-trip.
describe("filling in a missing show-from", () => {
  it("derives one when a due date is set on an action that has none", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    const [next] = onChange.mock.calls[0];
    // Lead time 0 in this fixture, so it lands on the due date itself.
    expect(next.showFrom).toBe(next.due);
    expect(next.due).not.toBe("");
  });

  // The sequence: pick a due date, pick a show-from, then move the due date.
  // The gap the user arranged is what carries over — not the default.
  it("recalculates the show-from when the due date changes again", () => {
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DateFields value={{ due: "2026-05-10", showFrom: "2026-05-03" }} onChange={onChange} idPrefix="t" />
      </QueryClientProvider>,
    );

    // A week's warning, then the deadline slips by two weeks.
    chooseDate("Due", "2026-05-24");

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-24", showFrom: "2026-05-17" });
    rerender(
      <QueryClientProvider client={client}>
        <DateFields value={{ due: "2026-05-24", showFrom: "2026-05-17" }} onChange={onChange} idPrefix="t" />
      </QueryClientProvider>,
    );
    // And again, from the new pair — the week is preserved each time.
    chooseDate("Due", "2026-06-01");
    expect(onChange).toHaveBeenLastCalledWith({ due: "2026-06-01", showFrom: "2026-05-25" });
  });
});

describe("opening a date from a form", () => {
  it("does not submit the surrounding form", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <form onSubmit={onSubmit}>
          <DateFields value={{ due: "", showFrom: "" }} onChange={onChange} idPrefix="t" />
        </form>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText("Due"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// A class assertion, and deliberately so: whether the field overruns the button
// beside it is a layout question, and jsdom has no layout engine — every test
// above would pass against a field drawn over its own clear button, which is
// what a phone showed. The browser suite measures it for real, but it is not
// installed by default, so the rule that prevents it is pinned here too.
describe("the date row on a narrow screen", () => {
  it("lets the field shrink, and keeps the clear button its own size", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DateFields value={{ due: "2026-09-24", showFrom: "" }} onChange={() => {}} idPrefix="t" />
      </QueryClientProvider>,
    );

    // min-width is auto on a flex item, and a date input's intrinsic width is
    // the whole date plus the picker button — so without this the label never
    // shrinks and takes the row with it.
    expect(screen.getByLabelText("Due").closest("label")!.className).toContain("min-w-0");
    expect(screen.getByLabelText("Clear the due date").className).toContain("shrink-0");
  });
});
