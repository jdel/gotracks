import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { QuickAdd } from "./QuickAdd";
import { useContexts } from "@/hooks/useContexts";
import { useTodos } from "@/hooks/useTodos";

// A miniature Home page: quick-add plus the list it is supposed to update.
function MiniHome() {
  const { data: contexts } = useContexts();
  const { data: todos } = useTodos({ state: "active" });
  return (
    <div>
      <QuickAdd />
      <ul>
        {contexts?.map((c) => (
          <li key={c.id}>context:{c.name}</li>
        ))}
      </ul>
      <ul>
        {todos?.map((t) => (
          <li key={t.id}>todo:{t.description}</li>
        ))}
      </ul>
    </div>
  );
}

/** Server state the fake backend keeps between requests. */
let contexts: { id: number; name: string; state: string; position: number }[];
let projects: unknown[];
let todos: Record<string, unknown>[];
let nextId: number;
/** When set, the fake server refuses a create with this 409 message. */
let quotaMessage: string | null;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

// A fake API that mimics the real one closely enough to exercise cache
// invalidation: creating a todo with an unknown contextName also creates it.
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";

  if (url.includes("/contexts") && method === "GET") return Promise.resolve(jsonResponse(contexts));
  if (url.includes("/projects") && method === "GET") return Promise.resolve(jsonResponse(projects));
  if (url.includes("/tags") && method === "GET") return Promise.resolve(jsonResponse([]));

  if (url.includes("/todos") && method === "GET") {
    return Promise.resolve(jsonResponse(todos));
  }

  if (url.includes("/todos") && method === "POST") {
    // null means "do not fail"; "" means "fail carrying no message".
    if (quotaMessage !== null) {
      return Promise.resolve(jsonResponse({ error: quotaMessage }, 409));
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    let contextId = body.contextId as number | undefined;
    if (!contextId && body.contextName) {
      const created = {
        id: nextId++,
        name: `@${body.contextName}`,
        state: "active",
        position: contexts.length + 1,
      };
      contexts = [...contexts, created];
      contextId = created.id;
    }
    // The server fills in a show-from for an action that has a due date, and
    // defers it — which is what the "waiting in the tickler" notice reacts to.
    const deferred = Boolean(body.due);
    const todo = {
      id: nextId++,
      contextId,
      description: body.description,
      due: body.due,
      showFrom: deferred ? body.due : undefined,
      state: deferred ? "deferred" : "active",
      starred: false,
      notes: "",
      position: 1,
      tags: body.tags ?? [],
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    todos = [...todos, todo];
    return Promise.resolve(jsonResponse(todo, 201));
  }

  return Promise.resolve(jsonResponse({}, 404));
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* A router, because the deferred notice links to the tickler. */}
      <MemoryRouter>
        <MiniHome />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  contexts = [{ id: 1, name: "@home", state: "active", position: 1 }];
  projects = [];
  todos = [];
  nextId = 100;
  quotaMessage = null;
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("QuickAdd defaults", () => {
  // The previous action's context is the most likely one for the next.
  it("defaults to the last used context", async () => {
    const user = userEvent.setup();
    contexts = [
      { id: 1, name: "@home", state: "active", position: 1 },
      { id: 2, name: "@calls", state: "active", position: 2 },
    ];
    localStorage.setItem("gt.lastContext", "2");
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("ring the bank{Enter}");

    await waitFor(() => expect(screen.getByText("todo:ring the bank")).toBeDefined());
    // Filed under @calls (id 2), not the first context in the list.
    expect(todos.at(-1)?.contextId).toBe(2);
  });

  it("remembers the context after adding", async () => {
    const user = userEvent.setup();
    contexts = [
      { id: 1, name: "@home", state: "active", position: 1 },
      { id: 2, name: "@calls", state: "active", position: 2 },
    ];
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("mow lawn @calls{Tab}{Enter}");

    await waitFor(() => expect(localStorage.getItem("gt.lastContext")).toBe("2"));
  });

  it("ignores a remembered context that no longer exists", async () => {
    const user = userEvent.setup();
    localStorage.setItem("gt.lastContext", "999");
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("buy milk{Enter}");

    await waitFor(() => expect(screen.getByText("todo:buy milk")).toBeDefined());
    expect(todos.at(-1)?.contextId).toBe(1);
  });
});

describe("QuickAdd list refresh", () => {
  it("shows a new action immediately, without a reload", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");

    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("buy milk{Enter}");

    await waitFor(() => expect(screen.getByText("todo:buy milk")).toBeDefined());
  });

  // The regression: an auto-created context must also appear, which only happens
  // if the contexts cache is invalidated alongside the todos cache.
  it("shows an action filed under a newly created context", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");

    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("buy paint @errands{Enter}");

    await waitFor(() => expect(screen.getByText("todo:buy paint")).toBeDefined());
    await waitFor(() => expect(screen.getByText("context:@errands")).toBeDefined());
  });
});

describe("QuickAdd error reporting", () => {
  // The server is the only party that knows which limit was hit and what the
  // ceiling is; replacing that with a generic failure leaves the user stuck.
  it("shows the server's quota message rather than a generic failure", async () => {
    const user = userEvent.setup();
    quotaMessage =
      "You have reached your limit of 200 actions. Delete some completed actions to make room.";
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("one too many{Enter}");

    await screen.findByText(/limit of 200 actions/);
    expect(screen.queryByText("Could not add action.")).toBeNull();
  });

  // A transport failure carries no useful server text, so the fallback stands.
  it("falls back to a local message when the failure carries none", async () => {
    const user = userEvent.setup();
    quotaMessage = "";
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("nope{Enter}");

    await screen.findByText("Could not add action.");
  });
});

describe("QuickAdd deferred notice", () => {
  // An action created with a due date can be parked in the tickler on the
  // spot, which means it is not in the list the user is looking at. Saying so
  // is the whole reason there is no separate "deferred" filter.
  it("says where the action went when the server defers it", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("renew passport");
    await user.click(screen.getByLabelText(/Add a due date/));
    await user.type(screen.getByLabelText("Due"), "2027-03-01");
    await user.keyboard("{Enter}");

    await screen.findByText(/waiting in the tickler/);
    expect(screen.getByRole("link", { name: "View tickler" }).getAttribute("href")).toBe("/tickler");
  });

  // No due date, no deferral, no notice — the action is in the list already.
  it("stays quiet for an action that is active straight away", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("buy milk{Enter}");

    await waitFor(() => expect(screen.getByText("todo:buy milk")).toBeDefined());
    expect(screen.queryByText(/waiting in the tickler/)).toBeNull();
  });
});
