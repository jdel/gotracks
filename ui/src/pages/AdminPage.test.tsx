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
/** Rows the fake backend returns for the user list. */
let users: Record<string, unknown>[] = [];

function adminUser(over: Record<string, unknown> = {}) {
  return {
    id: 2,
    email: "bob@example.com",
    isAdmin: false,
    twoFactorEnabled: false,
    deletionRequested: false,
    overQuota: false,
    emailVerifiedAt: "2026-07-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  requests.length = 0;
  users = [];
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
      if (url.includes("/admin/users")) {
        return new Response(
          JSON.stringify({ items: users, total: users.length, page: 1, pageSize: 25 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
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

// The state column is chips rather than prose, and two of them warn: an account
// on its way out, and one that cannot create anything more.
describe("admin user state chips", () => {
  it("flags a pending deletion and an account over its quota", async () => {
    users = [
      adminUser({ id: 2, email: "leaving@example.com", deletionRequested: true }),
      adminUser({ id: 3, email: "full@example.com", overQuota: true }),
      adminUser({ id: 4, email: "invited@example.com", emailVerifiedAt: undefined }),
    ];
    renderPage();

    // Rendered twice by DataTable — once as a card, once as a table row.
    expect((await screen.findAllByText("deletion requested")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("over quota").length).toBeGreaterThan(0);
    expect(screen.getAllByText("invited").length).toBeGreaterThan(0);
  });

  it("shows no warning chips for an ordinary account", async () => {
    users = [adminUser()];
    renderPage();

    await screen.findAllByText("bob@example.com");
    expect(screen.queryByText("deletion requested")).toBeNull();
    expect(screen.queryByText("over quota")).toBeNull();
  });
});

// Sorting is the server's job, so a header click has to reach the API — sorting
// the page in the browser would only reorder the rows already fetched.
describe("admin user sorting", () => {
  it("asks the server for each order in turn", async () => {
    const user = userEvent.setup();
    users = [adminUser()];
    renderPage();

    await screen.findAllByText("bob@example.com");
    const header = () => screen.getByRole("button", { name: /Email/i });

    await user.click(header());
    await waitFor(() => expect(requests.some((r) => r.includes("sort=email&dir=asc"))).toBe(true));

    await user.click(header());
    await waitFor(() => expect(requests.some((r) => r.includes("sort=email&dir=desc"))).toBe(true));

    // A third click clears the sort rather than cycling back to ascending.
    await user.click(header());
    await waitFor(() =>
      expect(requests.filter((r) => r.includes("/admin/users")).at(-1)).not.toContain("sort="),
    );
  });
});
