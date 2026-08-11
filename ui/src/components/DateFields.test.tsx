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
    expect(screen.getByText("Set a due date to use these.")).toBeTruthy();
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
    expect(onChange).toHaveBeenCalledWith({ due: "2026-09-24", showFrom: "" });
  });

  // The quick-sets are a single deliberate tap, so they save at once.
  it("commits a quick-set immediately", () => {
    const onChange = renderFields({ due: "2026-05-10", showFrom: "" });

    fireEvent.click(screen.getByRole("button", { name: "1 day before" }));

    expect(onChange).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-09" });
  });
});
