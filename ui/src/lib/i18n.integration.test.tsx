import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/lib/AuthProvider";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/I18nProvider";
import { LoginPage } from "@/pages/LoginPage";

// prefsResponse lets each test decide what GET /preferences returns, so the
// signed-out (401) and stale-session (200) cases can both be exercised.
let prefsResponse: { status: number; body: unknown };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/preferences")) {
    return Promise.resolve(jsonResponse(prefsResponse.body, prefsResponse.status));
  }
  if (url.includes("/config")) {
    return Promise.resolve(jsonResponse({ allowRegister: true, passkeys: false, twoFactor: false }));
  }
  if (url.includes("/me")) return Promise.resolve(jsonResponse({}, 401));
  return Promise.resolve(jsonResponse({}, 404));
}

// Mirrors the real provider nesting from main.tsx.
function renderApp(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <ThemeProvider>
            <I18nProvider>
              <LoginPage />
            </I18nProvider>
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  prefsResponse = { status: 401, body: {} };
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("sign-in language selection", () => {
  it("switches the page to French when picked (no session)", async () => {
    const user = userEvent.setup();
    renderApp();

    // Starts English.
    expect(await screen.findByText("No account?")).toBeDefined();

    await user.selectOptions(screen.getByLabelText(/language|langue/i), "fr");

    // The whole form re-renders in French.
    expect(screen.getByText("Pas encore de compte ?")).toBeDefined();
    expect(screen.queryByText("No account?")).toBeNull();
  });

  // The device choice on a signed-out page must win even when the query cache
  // still holds an English preference from a previous signed-in session — the
  // exact case that used to freeze the dropdown while /preferences 401'd.
  it("still switches when a stale English preference sits in the cache", async () => {
    const user = userEvent.setup();
    renderApp((client) =>
      client.setQueryData(["preferences"], { locale: "en", theme: "system" }),
    );

    await screen.findByText("No account?");
    await user.selectOptions(screen.getByLabelText(/language|langue/i), "fr");

    expect(screen.getByText("Pas encore de compte ?")).toBeDefined();
  });
});
