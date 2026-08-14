import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("the due and show-from pair", () => {
  // The gap between the two dates is what the user arranged; moving the
  // deadline should not silently change how much warning they get.
  it("carries the show-from along when the due date moves, keeping the gap", () => {
    const onChange = renderFields({ due: "2000-02-01", showFrom: "2000-01-01" });

    // Committed on blur, not on every keystroke: a date input reports "2000"
    // before it reports "2000-02-15", and saving that would be a wrong date.
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2000-02-15" } });
    fireEvent.blur(screen.getByLabelText("Due"), { target: { value: "2000-02-15" } });

    expect(onChange).toHaveBeenCalledWith({ due: "2000-02-15", showFrom: "2000-01-15" });
  });

  // An action may not hide past the day it is due — the same rule the server
  // enforces, applied here so the field shows what will be stored.
  it("pulls a show-from set after the due date back to it", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "" });

    fireEvent.change(screen.getByLabelText("Show from"), { target: { value: "2026-05-20" } });
    fireEvent.blur(screen.getByLabelText("Show from"), { target: { value: "2026-05-20" } });

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-10" });
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

  // Parking an undated action arbitrarily far ahead stays possible: only the
  // relative quick-sets need a due date, not the field itself.
  it("still allows a show-from to be picked without a due date", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    fireEvent.change(screen.getByLabelText("Show from"), { target: { value: "2027-03-01" } });
    fireEvent.blur(screen.getByLabelText("Show from"), { target: { value: "2027-03-01" } });

    expect(onChange).toHaveBeenCalledWith({ due: "", showFrom: "2027-03-01" });
  });

  it("clears the due date, and the show-from with it stays put", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "2026-05-01" });

    fireEvent.click(screen.getByLabelText("Clear the due date"));

    expect(onChange).toHaveBeenCalledWith({ due: "", showFrom: "2026-05-01" });
  });
});

// A date input reports a value per component as it is filled: "2026", then
// "2026-09", then the whole date. Saving those interim values would store a
// wrong date, and could move the action out of the list being looked at before
// the day had even been chosen.
describe("while a date is being typed", () => {
  it("does not commit a half-typed date", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-09" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits once the field is left", () => {
    const onChange = renderFields({ due: "", showFrom: "" });

    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-09-24" } });
    fireEvent.blur(screen.getByLabelText("Due"), { target: { value: "2026-09-24" } });

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
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-05-24" } });
    fireEvent.blur(screen.getByLabelText("Due"), { target: { value: "2026-05-24" } });

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-24", showFrom: "2026-05-17" });
    rerender(
      <QueryClientProvider client={client}>
        <DateFields value={{ due: "2026-05-24", showFrom: "2026-05-17" }} onChange={onChange} idPrefix="t" />
      </QueryClientProvider>,
    );
    // And again, from the new pair — the week is preserved each time.
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-06-01" } });
    fireEvent.blur(screen.getByLabelText("Due"), { target: { value: "2026-06-01" } });
    expect(onChange).toHaveBeenLastCalledWith({ due: "2026-06-01", showFrom: "2026-05-25" });
  });
});

// Enter commits the date being typed. It must not also reach the form around
// the field: submitting the add form there saves the action and clears the
// dates, so the field appeared to empty itself.
describe("pressing Enter in a date field", () => {
  it("commits the date without submitting the form", () => {
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

    const due = screen.getByLabelText("Due");
    fireEvent.change(due, { target: { value: "2026-09-24" } });
    // fireEvent returns false when the handler cancelled the event, which is
    // what stops the browser submitting the form around it. jsdom never
    // performs that implicit submit, so asserting on onSubmit alone would pass
    // even with the bug.
    const notCancelled = fireEvent.keyDown(due, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({ due: "2026-09-24", showFrom: "2026-09-24" });
    expect(notCancelled).toBe(false);
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
