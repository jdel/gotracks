import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconButton } from "@/components/IconButton";
import { ConfirmDialog } from "./ConfirmDialog";

// A destructive icon button wired the way the real pages wire theirs.
function Subject({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <IconButton label="Delete this action" onClick={() => setOpen(true)}>
        <span aria-hidden>x</span>
      </IconButton>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this action?"
        description="This cannot be undone."
        onConfirm={() => {
          onDelete();
          setOpen(false);
        }}
      />
    </TooltipProvider>
  );
}

describe("destructive action confirmation", () => {
  it("does not act until the user confirms", async () => {
    const onDelete = vi.fn();
    render(<Subject onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete this action" }));
    // The dialog is up, but nothing has happened yet.
    expect(screen.getByText("Delete this action?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("cancelling leaves the item alone", async () => {
    const onDelete = vi.fn();
    render(<Subject onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete this action" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete this action?")).toBeNull();
  });

  it("escape dismisses without acting", async () => {
    const onDelete = vi.fn();
    render(<Subject onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete this action" }));
    await userEvent.keyboard("{Escape}");

    expect(onDelete).not.toHaveBeenCalled();
  });

  // A stray Enter on an opened dialog must not destroy anything, so focus
  // starts on Cancel rather than the destructive button.
  it("opens with focus on cancel, not on the destructive button", async () => {
    const onDelete = vi.fn();
    render(<Subject onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete this action" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.keyboard("{Enter}");
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("icon buttons", () => {
  it("expose their action as an accessible name", () => {
    render(
      <TooltipProvider>
        <IconButton label="Star this action" onClick={() => {}}>
          <span aria-hidden>*</span>
        </IconButton>
      </TooltipProvider>,
    );
    // An icon alone is unreadable; the label is what a screen reader announces.
    expect(screen.getByRole("button", { name: "Star this action" })).toBeTruthy();
  });
});
