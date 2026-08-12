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
