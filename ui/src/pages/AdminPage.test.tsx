import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { AdminPage } from "./AdminPage";
import { useAuth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));

// The admin switch is a Radix control that measures itself; jsdom has no
// ResizeObserver, and this page is the first test to render one.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, email: "admin@example.com", isAdmin: true },
    ready: true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/admin/users") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ error: "that email address is already registered" }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/admin/users")) return new Response("[]", { status: 200 });
      if (url.includes("/admin/settings")) {
        return new Response(JSON.stringify({ allowRegister: false }), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <MemoryRouter>
        <I18nProvider>
          <AdminPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin user invitation", () => {
  // The form and the row actions each render the error state they share. With
  // one variable behind both, every failed invitation printed twice.
  it("reports a rejected invitation exactly once", async () => {
    renderPage();

    // The header carries a mobile "+" with the same label, so the submit is
    // reached through the form itself.
    const field = await screen.findByPlaceholderText("Email");
    await userEvent.type(field, "taken@example.com");
    const form = field.closest("form")!;
    await userEvent.click(within(form).getByRole("button", { name: /New user/i }));

    await waitFor(() =>
      expect(screen.getAllByText("that email address is already registered")).toHaveLength(1),
    );
  });
});
