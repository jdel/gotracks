import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateEditor } from "./DateEditor";

function renderEditor(due = "", showFrom = "") {
  const onSave = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DateEditor value={{ due, showFrom }} onSave={onSave} idPrefix="test" />
      <button type="button">elsewhere</button>
    </QueryClientProvider>,
  );
  return onSave;
}

// Picking a due date is usually the first half of a thought whose second half
// is the show-from. Saving on the first tap files the action somewhere else —
// out of the list being looked at, taking the open panel with it — before the
// second tap ever happens.
describe("collecting a date edit", () => {
  it("saves nothing when a quick-set is tapped", async () => {
    const user = userEvent.setup();
    const onSave = renderEditor();

    await user.click(screen.getByRole("button", { name: "Tomorrow" }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves both dates together on Apply", async () => {
    const user = userEvent.setup();
    const onSave = renderEditor("2026-05-10", "");

    await user.click(screen.getByRole("button", { name: "1 week before" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-03" });
  });

  it("keeps Apply inert until something changes", async () => {
    const user = userEvent.setup();
    renderEditor("2026-05-10", "2026-05-03");

    expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "1 day before" }));
    expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", false);
  });

  // The edit someone walks away from still lands.
  it("saves when focus leaves the block", () => {
    const onSave = renderEditor("2026-05-10", "");

    fireEvent.change(screen.getByLabelText("Show from"), { target: { value: "2026-05-01" } });
    fireEvent.blur(screen.getByLabelText("Show from"), { target: { value: "2026-05-01" } });

    expect(onSave).toHaveBeenCalledWith({ due: "2026-05-10", showFrom: "2026-05-01" });
  });

  // Moving between the two fields is not leaving the block, so a half-made
  // edit is not written on the way past.
  it("does not save while focus moves between its own controls", () => {
    const onSave = renderEditor("2026-05-10", "");
    const showFrom = screen.getByLabelText("Show from");

    fireEvent.change(showFrom, { target: { value: "2026-05-01" } });
    fireEvent.blur(showFrom, { relatedTarget: screen.getByLabelText("Due") });

    expect(onSave).not.toHaveBeenCalled();
  });
});
