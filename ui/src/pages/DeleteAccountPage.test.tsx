import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { DeleteAccountPage } from "./DeleteAccountPage";

const { confirmDeletion, logout } = vi.hoisted(() => ({
  confirmDeletion: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useServerConfig: () => ({ data: { legal: false } }),
  useConfirmAccountDeletion: () => ({ mutateAsync: confirmDeletion, isPending: false }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout }) }));

describe("DeleteAccountPage", () => {
  it("deletes immediately from the final red button without another confirmation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/delete-account?token=mailed-token"]}>
        <DeleteAccountPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("All of your data will be lost forever.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download JSON export" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Permanently delete my account" }));
    expect(confirmDeletion).toHaveBeenCalledWith({ token: "mailed-token" });
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.getByText("Your account has been permanently deleted.")).toBeTruthy();
  });
});
