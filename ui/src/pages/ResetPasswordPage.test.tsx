import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcceptInvitationPage } from "./ResetPasswordPage";
import { I18nProvider } from "@/lib/I18nProvider";

const { establishSession } = vi.hoisted(() => ({ establishSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ establishSession }) }));

afterEach(() => vi.unstubAllGlobals());

describe("account invitation", () => {
  it("activates the account and establishes its initial session", async () => {
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: typeof input === "string" ? input : input.toString(),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, string>,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          user: {
            id: 1,
            email: "invited@example.com",
            isAdmin: false,
            emailVerifiedAt: "2026-07-23T00:00:00Z",
            createdAt: "2026-07-23T00:00:00Z",
            updatedAt: "2026-07-23T00:00:00Z",
          },
          tokens: { accessToken: "access", refreshToken: "refresh", expiresAt: "2026-07-23T00:15:00Z" },
        }),
      } as Response;
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/accept-invitation?token=mailed-token"]}>
          <I18nProvider>
            <AcceptInvitationPage />
          </I18nProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("New password"), "Invited-Passw0rd!");
    await user.type(screen.getByLabelText("Confirm new password"), "Invited-Passw0rd!");
    await user.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() => expect(establishSession).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ email: "invited@example.com" }),
      tokens: expect.objectContaining({ accessToken: "access" }),
    })));
    // The legal footer asks the instance whether it serves those pages at all,
    // which is why /config is read before the account is activated.
    // The page asks whether the instance serves policies at all before it can
    // know whether to show the consent boxes. This one does not, so no boxes
    // are shown and nothing is accepted.
    expect(requests).toEqual([
      { url: "/api/v1/config", body: {} },
      {
        url: "/api/v1/auth/invitation/accept",
        body: { token: "mailed-token", newPassword: "Invited-Passw0rd!", acceptLegal: false },
      },
    ]);
  });
});
