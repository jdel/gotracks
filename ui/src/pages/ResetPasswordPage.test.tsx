import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AcceptInvitationPage } from "./ResetPasswordPage";
import { I18nProvider } from "@/lib/I18nProvider";

afterEach(() => vi.unstubAllGlobals());

describe("account invitation", () => {
  it("submits the mailed token and chosen password", async () => {
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: typeof input === "string" ? input : input.toString(),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, string>,
      });
      return { ok: true, status: 204 } as Response;
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

    expect(await screen.findByText(/account is active/)).toBeDefined();
    expect(requests).toEqual([{
      url: "/api/v1/auth/invitation/accept",
      body: { token: "mailed-token", newPassword: "Invited-Passw0rd!" },
    }]);
  });
});
