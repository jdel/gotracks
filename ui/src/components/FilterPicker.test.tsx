import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterPicker } from "./FilterPicker";

const options = [
  { value: "", label: "No project" },
  { value: "1", label: "kitchen" },
  { value: "2", label: "kitchen extension" },
  { value: "3", label: "taxes" },
];

function renderPicker(value = "") {
  const onChange = vi.fn();
  render(
    <FilterPicker
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel="Project"
      filterLabel="Filter projects"
      noMatchLabel="No match."
    />,
  );
  return onChange;
}

// A native select is fine for four projects and useless for forty: there is no
// way to narrow it.
describe("picking from a filtered list", () => {
  it("shows the current choice in the field", () => {
    renderPicker("3");
    expect(screen.getByLabelText("Project")).toHaveProperty("value", "taxes");
  });

  it("narrows the list as you type", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.type(screen.getByLabelText("Filter projects"), "kitchen");

    expect(screen.getByRole("button", { name: "kitchen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "kitchen extension" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "taxes" })).toBeNull();
  });

  it("reports the value of what was chosen, not its label", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.type(screen.getByLabelText("Filter projects"), "tax");
    await user.click(screen.getByRole("button", { name: "taxes" }));

    expect(onChange).toHaveBeenCalledWith("3");
  });

  // "" is a real choice — it is how "no project" is expressed.
  it("can choose the empty option", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker("1");

    await user.click(screen.getByLabelText("Project"));
    await user.click(screen.getByRole("button", { name: "No project" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.type(screen.getByLabelText("Filter projects"), "zzz");

    expect(screen.getByText("No match.")).toBeTruthy();
  });

  // Reopening on a stale filter would show a list narrowed by something the
  // user typed minutes ago.
  it("forgets the filter after closing", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.type(screen.getByLabelText("Filter projects"), "tax");
    await user.click(screen.getByRole("button", { name: "taxes" }));
    await user.click(screen.getByLabelText("Project"));

    expect(screen.getByLabelText("Filter projects")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "kitchen" })).toBeTruthy();
  });
});

// The options used to be tab stops, so Tab walked the whole list instead of
// moving to the next field — forty contexts, forty presses. The list is driven
// from the filter box: arrows move, Enter picks, Tab leaves.
describe("keyboard navigation", () => {
  it("keeps the options out of the tab order", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByLabelText("Project"));

    for (const option of screen.getAllByRole("button")) {
      expect(option.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("moves through the list with the arrows and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByLabelText("Project"));
    // From "No project" down to "kitchen extension".
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("does not run past either end of the list", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    // Still the first option rather than wrapping to the last.
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("closes on Tab without picking anything", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByLabelText("Project"));
    await user.keyboard("{ArrowDown}");
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Filter projects")).toBeNull();
  });
});

// The field shows the current choice and is read-only, so typing into it did
// nothing at all: the list had to be opened first, then typed into. A keyboard
// user should be able to start typing the name they want.
describe("typing straight into the field", () => {
  it("opens the list and filters by what was typed", async () => {
    const user = userEvent.setup();
    renderPicker();

    screen.getByLabelText("Project").focus();
    await user.keyboard("k");

    expect(screen.getByLabelText("Filter projects")).toHaveProperty("value", "k");
    expect(screen.getByRole("button", { name: "kitchen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "taxes" })).toBeNull();
  });

  it("leaves modified keys alone", async () => {
    const user = userEvent.setup();
    renderPicker();

    screen.getByLabelText("Project").focus();
    await user.keyboard("{Control>}a{/Control}");

    expect(screen.queryByLabelText("Filter projects")).toBeNull();
  });
});

// Closing the list has to put focus somewhere sensible. It does not restore
// itself — that is refused so Tab can move onward — so every other exit has to
// hand it back, or it falls to the first thing in the document, which is the
// sidebar's collapse button.
describe("where focus goes when the list closes", () => {
  it("returns to the field after picking with Enter", async () => {
    const user = userEvent.setup();
    renderPicker();
    const field = screen.getByLabelText("Project");

    await user.click(field);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(document.activeElement).toBe(field);
  });

  it("returns to the field after Escape", async () => {
    const user = userEvent.setup();
    renderPicker();
    const field = screen.getByLabelText("Project");

    await user.click(field);
    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(field);
  });

  it("returns to the field after picking with the mouse", async () => {
    const user = userEvent.setup();
    renderPicker();
    const field = screen.getByLabelText("Project");

    await user.click(field);
    await user.click(screen.getByRole("button", { name: "taxes" }));

    expect(document.activeElement).toBe(field);
  });
});
