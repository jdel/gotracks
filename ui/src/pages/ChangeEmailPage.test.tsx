import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChangeEmailPage } from "./ChangeEmailPage";

const { confirmEmailChange, logout } = vi.hoisted(() => ({
  confirmEmailChange: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useConfirmEmailChange: () => ({ mutateAsync: confirmEmailChange }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout }) }));

describe("ChangeEmailPage", () => {
  it("confirms the mailed address and signs out revoked sessions", async () => {
    render(
      <MemoryRouter initialEntries={["/change-email?token=mailed-token"]}>
        <ChangeEmailPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Your email address has been changed. Sign in again with the new address.")).toBeTruthy();
    expect(confirmEmailChange).toHaveBeenCalledWith({ token: "mailed-token" });
    expect(logout).toHaveBeenCalledOnce();
  });
});
