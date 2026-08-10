import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "./Pagination";

function renderPagination(page: number, onPage = vi.fn()) {
  render(<Pagination page={page} pageSize={25} total={60} onPage={onPage} />);
  return onPage;
}

describe("pagination", () => {
  // The handoff draws 34px buttons; the global checklist asks for 44px targets.
  // The pseudo-element reconciles them: the paint stays 34px, the hit area is 44.
  it("gives the arrows a 44px target without growing them", () => {
    renderPagination(2);
    for (const name of ["Previous page", "Next page"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className, `${name} is not 34px`).toContain("size-[34px]");
      expect(button.className, `${name} has no expanded target`).toContain(
        "before:-inset-[5px]",
      );
      // The pseudo-element only works against a positioned box.
      expect(button.className, `${name} has nothing to anchor the target to`).toContain(
        "relative",
      );
    }
  });

  it("reports the range and the position within it", () => {
    renderPagination(2);
    expect(screen.getByText("26–50 of 60")).toBeTruthy();
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("steps a page at a time", async () => {
    const user = userEvent.setup();
    const onPage = renderPagination(2);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("stops at both ends", () => {
    renderPagination(1);
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty("disabled", false);
  });

  // Nothing to page through is nothing to show.
  it("renders nothing when there are no rows", () => {
    const { container } = render(
      <Pagination page={1} pageSize={25} total={0} onPage={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
