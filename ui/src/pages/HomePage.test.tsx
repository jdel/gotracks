import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "./HomePage";

// The header block reads the account for its avatar; a stub keeps the page out
// of the AuthProvider so these tests stay focused on the actions list.
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

let contexts: { id: number; name: string; state: string; position: number }[];
let todos: Record<string, unknown>[];
/** Account preferences; null serves a 401, as an unauthenticated test would. */
let prefs: Record<string, unknown> | null;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, blob: async () => new Blob() } as Response;
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/contexts")) return Promise.resolve(jsonResponse(contexts));
  if (url.includes("/todos")) return Promise.resolve(jsonResponse(todos));
  if (url.includes("/projects")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/tags")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/attachments")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/preferences")) {
    return prefs
      ? Promise.resolve(jsonResponse(prefs))
      : Promise.resolve(jsonResponse({}, 401));
  }
  return Promise.resolve(jsonResponse({}, 404));
}

function todo(id: number, contextId: number, description: string, tags: string[] = []) {
  return {
    id,
    contextId,
    description,
    tags,
    notes: "",
    state: "active",
    starred: false,
    position: id,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  prefs = null;
  contexts = [
    { id: 1, name: "@home", state: "active", position: 1 },
    { id: 2, name: "@work", state: "active", position: 2 },
  ];
  todos = [
    todo(1, 1, "paint the fence", ["outdoor"]),
    todo(2, 1, "call the plumber"),
    todo(3, 2, "write the report"),
  ];
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("actions view", () => {
  it("filters actions by description", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("paint the fence");
    await user.type(screen.getByLabelText("Filter actions"), "plumber");

    await waitFor(() => expect(screen.queryByText("paint the fence")).toBeNull());
    expect(screen.getByText("call the plumber")).toBeDefined();
    // The whole non-matching context drops out too.
    expect(screen.queryByText("write the report")).toBeNull();
  });

  it("clears the filter with the clear button", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("paint the fence");
    await user.type(screen.getByLabelText("Filter actions"), "plumber");
    await waitFor(() => expect(screen.queryByText("paint the fence")).toBeNull());

    await user.click(screen.getByLabelText("Clear search"));

    expect(await screen.findByText("paint the fence")).toBeDefined();
    expect(screen.getByText("write the report")).toBeDefined();
  });

  it("filters by tag", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("paint the fence");
    await user.type(screen.getByLabelText("Filter actions"), "outdoor");

    expect(screen.getByText("paint the fence")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("call the plumber")).toBeNull());
  });

  it("opens the quick-add sheet from the header button", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("paint the fence");
    await user.click(screen.getByLabelText("Add an action"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Add an action/)).toBeDefined();
    // The dates/tags panel is open up front in the mobile flow.
    expect(within(dialog).getByLabelText("Due")).toBeDefined();

    // Escape closes the sheet.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// "Today" and "overdue" are calendar-day questions, and the answer has to come
// from the account's time zone. The same action, at the same instant, is due
// today in Honolulu (UTC-10) and overdue in UTC — so asserting both pins the
// behaviour to the preference rather than to whatever zone the test machine is
// in, which is the bug this replaced.
describe("overdue in the account's time zone", () => {
  const DUE = "2026-08-10T15:00:00Z";
  const NOW = "2026-08-11T05:00:00Z";

  function renderWithZone(timeZone: string) {
    prefs = { timeZone, dateFormat: "2006-01-02", locale: "en" };
    todos = [{ ...todo(1, 1, "pay the invoice"), due: DUE }];
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <HomePage />
      </QueryClientProvider>,
    );
  }

  async function overdueMetric() {
    const metric = await screen.findByText(/overdue/);
    return metric.textContent?.trim();
  }

  it("counts nothing overdue while it is still today for the account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date(NOW));
      renderWithZone("Pacific/Honolulu");
      expect(await overdueMetric()).toBe("0 overdue");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts it overdue once the account's day has moved on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date(NOW));
      renderWithZone("UTC");
      expect(await overdueMetric()).toBe("1 overdue");
    } finally {
      vi.useRealTimers();
    }
  });
});
