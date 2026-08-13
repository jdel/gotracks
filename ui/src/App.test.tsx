import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { App } from "./App";
import { useAuth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
// The real shell is a whole navigation; the routes are what is under test, so
// it stands in as a marker with the outlet its children need.
vi.mock("@/components/Layout", () => ({
  Layout: () => (
    <div>
      Application shell
      <Outlet />
    </div>
  ),
}));
// The redirect target stands in for itself: what matters here is that a
// bounced user lands on it, not what home renders.
vi.mock("@/pages/HomePage", () => ({ HomePage: () => <div>Home page</div> }));
// The signed-in tree asks the server whether this account owes agreement to a
// policy, so these routes need a query client the way the real application has.
vi.mock("@/hooks/useLegal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useLegal")>()),
  // Only the agreement prompt is stubbed. The editor's own query is left real:
  // it is the request that proves the admin page mounted.
  useLegalPending: () => ({ data: [] }),
  useLegalDocuments: () => ({ data: [] }),
  useAcceptLegal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function signedIn(isAdmin: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 1,
      login: "user0001",
      email: "user0001@example.com",
      isAdmin,
      createdAt: "",
      updatedAt: "",
    },
    ready: true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

/** Every request the tree made, so "never asked" can be told from "hidden". */
let requested: string[] = [];

beforeEach(() => {
  signedIn(false);
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return {
        ok: true,
        status: 200,
        // Enough shape for any page that does get as far as rendering: the
        // instance serves legal pages, and every collection is empty.
        json: async () => ({ legal: true, items: [], total: 0 }),
      } as Response;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(route: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const adminRoutes = ["/admin", "/admin/settings", "/reports", "/legal", "/audit"];
const adminRequest = () => requested.filter((url) => url.includes("/api/v1/admin"));

describe("authenticated entry routes", () => {
  it.each(["/login", "/register"])("redirects %s to the application", async (route) => {
    renderAt(route);

    expect(await screen.findByText("Application shell")).toBeDefined();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });
});

describe("administrator routes", () => {
  it.each(adminRoutes)("keeps a non-admin off %s", async (route) => {
    renderAt(route);

    // Landed somewhere real — home — rather than on an admin page reporting a
    // wall of refusals.
    expect(await screen.findByText("Home page")).toBeDefined();
    // The valuable assertion: the page never mounted, so it never asked. A
    // guard that let the page render and merely hid its output would still
    // fire every one of these.
    await waitFor(() => expect(adminRequest()).toEqual([]));
  });

  it.each(adminRoutes)("lets an administrator into %s", async (route) => {
    signedIn(true);
    renderAt(route);

    await waitFor(() => expect(adminRequest().length).toBeGreaterThan(0));
  });
});
