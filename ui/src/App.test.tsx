import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router";
import { I18nProvider } from "@/lib/I18nProvider";
import { App } from "./App";
import { useAuth } from "@/lib/auth";
import { aUser } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";

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
    user: aUser({ isAdmin }),
    ready: true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

/** Every request the tree made, so "never asked" can be told from "hidden". */
let requested: string[] = [];

beforeEach(() => {
  signedIn(false);
  requested = [];
  // Deliberately not `mockApi`: this suite mounts every admin page behind the
  // guard and asserts on which URLs were asked for, so it needs a recorder that
  // answers anything. Enumerating each page's routes would make the test about
  // those routes rather than about the guard, and an unrouted request throwing
  // would fail the admin cases for a reason that is not what is under test.
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

const renderAt = (route: string) =>
  renderWithProviders(
    <I18nProvider>
      <App />
    </I18nProvider>,
    { route },
  );

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
