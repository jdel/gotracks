import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickAdd } from "./QuickAdd";
import { useContexts } from "@/hooks/useContexts";
import { useTodos } from "@/hooks/useTodos";
import { mockApi, reply, type MockApi } from "@/test/api";
import { aContext, aProject, aTodo } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { Context, Project, Todo } from "@/lib/types";

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

/**
 * Server state the fake backend keeps between requests. These tests are about
 * cache invalidation, so the routes below read this state on every call rather
 * than answering with a snapshot taken when the server was installed.
 */
let contexts: Context[];
let projects: Project[];
let todos: Todo[];
let nextId: number;
/** When set, the fake server refuses a create with this 409 message. */
let quotaMessage: string | null;
/** When set, the request never reaches a server at all. */
let offline: boolean;
let api: MockApi;

/** Mimics the real API closely enough that an unknown "@name" creates a context. */
function createTodo(body: Record<string, unknown>): Todo {
  let contextId = body.contextId as number | undefined;
  if (!contextId && body.contextName) {
    const created = aContext({
      id: nextId++,
      name: `@${String(body.contextName)}`,
      position: contexts.length + 1,
    });
    contexts = [...contexts, created];
    contextId = created.id;
  }
  // The server fills in a show-from for an action that has a due date, and
  // defers it — which is what the "waiting in the tickler" notice reacts to.
  const due = body.due as string | undefined;
  const todo = aTodo({
    id: nextId++,
    contextId,
    // Echoed, so a test can tell "filed under no project" from "the fixture
    // never carried one".
    projectId: body.projectId as number | undefined,
    description: String(body.description),
    due,
    showFrom: due,
    state: due ? "deferred" : "active",
    tags: (body.tags as string[]) ?? [],
  });
  todos = [...todos, todo];
  return todo;
}

beforeEach(() => {
  contexts = [aContext({ id: 1, name: "@home" })];
  projects = [];
  todos = [];
  nextId = 100;
  quotaMessage = null;
  offline = false;
  localStorage.setItem("gt.access", "test-token");
  api = mockApi({
    "GET /contexts": () => contexts,
    "GET /projects": () => projects,
    "GET /tags": [],
    "GET /todos": () => todos,
    "POST /todos": ({ body }) => {
      // What a browser does when the request never arrives: fetch rejects, and
      // there is no response to take any wording from.
      if (offline) throw new TypeError("Failed to fetch");
      if (quotaMessage !== null) return reply(409, { error: quotaMessage });
      return reply(201, createTodo(body as Record<string, unknown>));
    },
  });
});

// A router, because the deferred notice links to the tickler.
const renderApp = () => renderWithProviders(<MiniHome />);

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("QuickAdd defaults", () => {
  // The previous action's context is the most likely one for the next.
  it("defaults to the last used context", async () => {
    const user = userEvent.setup();
    contexts = [aContext({ id: 1, name: "@home" }), aContext({ id: 2, name: "@calls", position: 2 })];
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
    contexts = [aContext({ id: 1, name: "@home" }), aContext({ id: 2, name: "@calls", position: 2 })];
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
  //
  // This used to be a 409 whose error field was empty, which passed only
  // because the hand-rolled stub left `statusText` undefined: a real refusal
  // always carries a status line, and the client shows that in preference to
  // its own wording. The failure with genuinely nothing to say is the one where
  // no response arrives.
  it("falls back to a local message when the failure carries none", async () => {
    const user = userEvent.setup();
    offline = true;
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
    // The dates are always on the form now — no disclosure to open first.
    await user.type(screen.getByLabelText("Due"), "2027-03-01");
    // Not Enter: inside a date field that commits the date and goes no
    // further, so the form is submitted from its own button.
    await user.click(screen.getByRole("button", { name: "Save" }));

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

// A context is mandatory on an action, so defaulting to the last one saves a
// choice that has to be made anyway. A project is not: inheriting the previous
// action's would quietly file unrelated things under it.
describe("QuickAdd project handling", () => {
  it("leaves a new action out of any project by default", async () => {
    const user = userEvent.setup();
    projects = [aProject({ id: 5, name: "#kitchen" })];
    // A project the previous session had used.
    localStorage.setItem("gt.lastProject", "5");
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("ring the bank{Enter}");

    await waitFor(() => expect(screen.getByText("todo:ring the bank")).toBeDefined());
    expect(todos.at(-1)?.projectId).toBeUndefined();
  });

  it("still files it under a project named with #", async () => {
    const user = userEvent.setup();
    projects = [aProject({ id: 5, name: "#kitchen" })];
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("fix the tap #kitchen{Tab}{Enter}");

    await waitFor(() => expect(screen.getByText("todo:fix the tap")).toBeDefined());
    expect(todos.at(-1)?.projectId).toBe(5);
  });
});

// The desktop capture bar is one line: type, Enter, carry on reading the list.
// The full form belongs to the mobile sheet, where there is room for it and no
// keyboard shortcut to lean on.
describe("the compact capture bar", () => {
  const renderCompact = () => renderWithProviders(<QuickAdd compact />);

  it("shows only the line and its buttons", async () => {
    renderCompact();
    await screen.findByLabelText(/Add an action/);

    expect(screen.queryByLabelText("Due")).toBeNull();
    expect(screen.queryByLabelText("Show from")).toBeNull();
    expect(screen.queryByLabelText("Tags (comma separated)")).toBeNull();
    expect(screen.queryByLabelText("Context")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  // A due date has no shorthand, so the bar has to be able to open into the
  // same fields the sheet shows.
  it("opens into the full fields and closes again", async () => {
    const user = userEvent.setup();
    renderCompact();
    await screen.findByLabelText(/Add an action/);

    await user.click(screen.getByRole("button", { name: /Add a due date/ }));
    expect(screen.getByLabelText("Due")).toBeTruthy();
    expect(screen.getByLabelText("Tags (comma separated)")).toBeTruthy();
    expect(screen.getByLabelText("Context")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Hide the extra fields/ }));
    expect(screen.queryByLabelText("Due")).toBeNull();
  });

  // The sheet is already the full form; a toggle there would toggle nothing.
  it("has no toggle when it is not compact", async () => {
    renderApp();
    await screen.findByText("context:@home");

    expect(screen.queryByRole("button", { name: /Add a due date/ })).toBeNull();
  });

  it("still adds from the line, with the tokens applied", async () => {
    const user = userEvent.setup();
    renderCompact();

    await user.click(await screen.findByLabelText(/Add an action/));
    await user.keyboard("ring the bank @calls !urgent{Enter}");

    await waitFor(() => expect(todos.at(-1)?.description).toBe("ring the bank"));
    expect(todos.at(-1)?.tags).toEqual(["urgent"]);
  });

  // The sheet keeps everything: it is the same component, not a second form.
  it("leaves the full form alone when not compact", async () => {
    renderApp();
    await screen.findByText("context:@home");

    expect(screen.getByLabelText("Due")).toBeTruthy();
    expect(screen.getByLabelText("Tags (comma separated)")).toBeTruthy();
  });
});

/**
 * Making a context or project from the picker.
 *
 * The shorthand — "@errands", "#garden" — could always do this, but the pickers
 * beside it only chose from what existed. A user who had not learned the
 * shorthand had to leave the form, make the context, and come back to the
 * action they were trying to capture.
 */
describe("naming a context or project in the picker", () => {
  it("sends the name for the server to create, without an id", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("ring the bank");

    await user.click(screen.getByLabelText("Context"));
    await user.type(screen.getByLabelText("Filter contexts"), "errands");
    await user.click(screen.getByRole("button", { name: /Create/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    // A name, and no contextId: there is no id until the server makes one.
    await waitFor(() => expect(api.lastBody()).toMatchObject({ contextName: "errands" }));
    expect(api.lastBody()).not.toHaveProperty("contextId");
  });

  it("shows the staged name in the field, before anything is saved", async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText("Context"));
    await user.type(screen.getByLabelText("Filter contexts"), "errands");
    await user.click(screen.getByRole("button", { name: /Create/ }));

    expect(screen.getByLabelText("Context")).toHaveProperty("value", "@errands");
    // Staged, not created: nothing has been written.
    expect(api.writes()).toEqual([]);
  });

  it("forgets the staged name once an existing one is chosen instead", async () => {
    const user = userEvent.setup();
    contexts = [aContext({ id: 1, name: "@home" }), aContext({ id: 2, name: "@calls", position: 2 })];
    renderApp();

    await screen.findByText("context:@home");
    await user.click(screen.getByLabelText(/Add an action/));
    await user.keyboard("ring the bank");

    await user.click(screen.getByLabelText("Context"));
    await user.type(screen.getByLabelText("Filter contexts"), "errands");
    await user.click(screen.getByRole("button", { name: /Create/ }));
    // Changed their mind: an existing one, which has an id.
    await user.click(screen.getByLabelText("Context"));
    await user.click(screen.getByRole("button", { name: "calls" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.lastBody()).toMatchObject({ contextId: 2 }));
    expect(api.lastBody()).not.toHaveProperty("contextName");
  });
});
