import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./primitives";

/**
 * A bare <button> inside a <form> submits it, and this app has been bitten by
 * that: the clear-date button in the action editor submitted the form, which
 * saves and closes the sheet, so tapping it looked like the drawer dismissing
 * itself. The button being retired defaults to type="button" for that reason;
 * the design-system one has to before any call site moves to it, or the whole
 * bug class comes back in a single commit.
 */
describe("the design-system button inside a form", () => {
  it("does not submit unless it says it does", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Clear</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when it is the form's submit button", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
