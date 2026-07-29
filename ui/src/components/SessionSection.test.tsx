import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { SessionSection } from "./SessionSection";
import { useSessions, useRevokeSession, useRevokeOtherSessions } from "@/hooks/useSessions";

vi.mock("@/hooks/useSessions");

const sessions = [
  { id: "here", startedAt: "2026-07-25T09:00:00Z", lastUsed: "2026-07-25T10:00:00Z", ip: "203.0.113.1", userAgent: "This browser", current: true },
  { id: "phone", startedAt: "2026-07-24T09:00:00Z", lastUsed: "2026-07-24T12:00:00Z", ip: "203.0.113.9", userAgent: "Safari on iPhone", current: false },
];

const revoke = vi.fn();
const revokeOthers = vi.fn();

beforeEach(() => {
  revoke.mockReset();
  revokeOthers.mockReset();
  vi.mocked(useSessions).mockReturnValue({ data: sessions } as unknown as ReturnType<typeof useSessions>);
  vi.mocked(useRevokeSession).mockReturnValue({ mutateAsync: revoke, isPending: false } as unknown as ReturnType<typeof useRevokeSession>);
  vi.mocked(useRevokeOtherSessions).mockReturnValue({ mutateAsync: revokeOthers, isPending: false } as unknown as ReturnType<typeof useRevokeOtherSessions>);
});

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <I18nProvider>
          <SessionSection />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("session section", () => {
  // The current device is marked and cannot be ended from the list — signing
  // out of the session you are using is what the sign-out button is for.
  it("marks the current device and offers it no revoke button", () => {
    renderSection();
    const rows = screen.getAllByRole("listitem");
    const current = rows.find((r) => within(r).queryByText("This device"));
    expect(current).toBeDefined();
    expect(within(current!).queryByRole("button")).toBeNull();

    const other = rows.find((r) => within(r).queryByText("Safari on iPhone"));
    expect(within(other!).getByRole("button", { name: "Sign out this session" })).toBeDefined();
  });

  it("ends a single session by its id", async () => {
    renderSection();
    const other = screen.getAllByRole("listitem").find((r) => within(r).queryByText("Safari on iPhone"))!;
    await userEvent.click(within(other).getByRole("button", { name: "Sign out this session" }));
    expect(revoke).toHaveBeenCalledWith("phone");
  });

  it("signs out everywhere else behind a confirmation", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));
    // A confirmation appears; confirm it.
    const confirm = screen.getAllByRole("button", { name: "Sign out everywhere else" }).at(-1)!;
    await userEvent.click(confirm);
    expect(revokeOthers).toHaveBeenCalled();
  });

  it("hides the sign-out-elsewhere button when this is the only session", () => {
    vi.mocked(useSessions).mockReturnValue({ data: [sessions[0]] } as unknown as ReturnType<typeof useSessions>);
    renderSection();
    expect(screen.queryByRole("button", { name: "Sign out everywhere else" })).toBeNull();
  });
});
