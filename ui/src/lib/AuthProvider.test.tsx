import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./auth";
import { api, tokenStore } from "./api";

/**
 * What happens between opening the app and the first screen.
 *
 * This is the seam every authenticated route waits on: `ready` gates the whole
 * signed-in tree, and getting it wrong is either a flash of the login page for
 * somebody who is signed in, or a spinner that never resolves. It had no test.
 */

const user = {
  id: 1,
  email: "alice@example.com",
  isAdmin: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, statusText: `status ${status}`, json: async () => body } as Response;
}

/** Answers each path from a queue; the last answer repeats. */
function fetchStub(routes: Record<string, Response[]>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const key = Object.keys(routes)
        .filter((k) => url.includes(k))
        .sort((a, b) => b.length - a.length)[0];
      if (!key) throw new Error(`unexpected request: ${url}`);
      const queued = routes[key];
      return queued.length > 1 ? queued.shift()! : queued[0];
    }),
  );
  return calls;
}

/** Reports what the rest of the app would see from the context. */
function Probe() {
  const { user: current, ready, logout } = useAuth();
  return (
    <div>
      <p>{ready ? "ready" : "restoring"}</p>
      <p>{current ? `signed in as ${current.email}` : "signed out"}</p>
      <button onClick={logout}>Sign out</button>
    </div>
  );
}

const renderApp = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("restoring a session on boot", () => {
  it("is ready at once when there is no session, and asks the server nothing", () => {
    const calls = fetchStub({});
    renderApp();

    // Not "ready after a tick": a visitor with no session must reach the login
    // page without the authenticated tree rendering its loading state first.
    expect(screen.getByText("ready")).toBeTruthy();
    expect(screen.getByText("signed out")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("holds the tree back until the stored session has been confirmed", async () => {
    tokenStore.set({ accessToken: "access", refreshToken: "refresh", expiresAt: "" });
    const calls = fetchStub({ "/me": [jsonResponse(user)] });
    renderApp();

    // Before the reply: not ready. Every authenticated route waits on this, and
    // treating "no user yet" as "signed out" would bounce a signed-in user to
    // the login page on every reload.
    expect(screen.getByText("restoring")).toBeTruthy();
    expect(screen.getByText("signed out")).toBeTruthy();

    expect(await screen.findByText("signed in as alice@example.com")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();
    expect(calls.filter((url) => url.includes("/me"))).toHaveLength(1);
  });

  it("becomes ready, signed out and empty-handed when the stored session is dead", async () => {
    tokenStore.set({ accessToken: "stale", refreshToken: "stale", expiresAt: "" });
    fetchStub({
      "/me": [jsonResponse({ error: "unauthorized" }, 401)],
      "/auth/refresh": [jsonResponse({ error: "revoked" }, 401)],
    });
    renderApp();

    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    expect(screen.getByText("signed out")).toBeTruthy();
    // The tokens go, or every later request retries a session the server has
    // already refused and the app never settles.
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it("restores through a refresh when only the access token has expired", async () => {
    tokenStore.set({ accessToken: "expired", refreshToken: "good", expiresAt: "" });
    fetchStub({
      "/me": [jsonResponse({ error: "expired" }, 401), jsonResponse(user)],
      "/auth/refresh": [
        jsonResponse({ accessToken: "fresh", refreshToken: "rotated", expiresAt: "" }),
      ],
    });
    renderApp();

    // The common case after leaving a tab open overnight: the access token is
    // short-lived, the refresh token is not, and the reload should be invisible.
    expect(await screen.findByText("signed in as alice@example.com")).toBeTruthy();
    expect(tokenStore.access).toBe("fresh");
  });
});

describe("a server that is merely unwell", () => {
  it("currently signs the user out when /me fails for any reason", async () => {
    tokenStore.set({ accessToken: "access", refreshToken: "refresh", expiresAt: "" });
    fetchStub({ "/me": [jsonResponse({ error: "database unavailable" }, 500)] });
    renderApp();

    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    expect(screen.getByText("signed out")).toBeTruthy();

    // Recorded rather than endorsed. A 401 is already handled by the transport,
    // which clears the tokens and fires onLogout; the provider's own catch only
    // ever fires for something else — a 500, a dropped connection — and it
    // throws away a refresh token the server never rejected. Reloading during a
    // brief outage therefore signs you out for good rather than for a minute.
    // Changing it is an auth-behaviour decision, not a test fix.
    expect(tokenStore.refresh).toBeNull();
  });
});

describe("the transport's forced logout", () => {
  it("empties the interface when a refresh fails later in the session", async () => {
    tokenStore.set({ accessToken: "access", refreshToken: "refresh", expiresAt: "" });
    fetchStub({
      "/me": [jsonResponse(user)],
      "/todos": [jsonResponse({ error: "unauthorized" }, 401)],
      "/auth/refresh": [jsonResponse({ error: "revoked" }, 401)],
    });
    renderApp();
    await screen.findByText("signed in as alice@example.com");

    // The provider's only wire into the transport: api.ts calls onLogout when a
    // refresh genuinely fails. Without it the tokens are gone but the interface
    // still shows a signed-in user, and every click fails silently.
    await expect(api.get("/todos")).rejects.toMatchObject({ status: 401 });

    await waitFor(() => expect(screen.getByText("signed out")).toBeTruthy());
  });

  it("tells the server to drop the refresh token when signing out", async () => {
    tokenStore.set({ accessToken: "access", refreshToken: "refresh-token", expiresAt: "" });
    const calls = fetchStub({
      "/me": [jsonResponse(user)],
      "/auth/logout": [jsonResponse({}, 204)],
    });
    renderApp();
    await screen.findByText("signed in as alice@example.com");

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    // Clearing local storage alone would leave the refresh token valid on the
    // server until it expired.
    expect(calls.some((url) => url.includes("/auth/logout"))).toBe(true);
    expect(tokenStore.refresh).toBeNull();
    expect(screen.getByText("signed out")).toBeTruthy();
  });
});
