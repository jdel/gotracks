import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesPage } from "./NotesPage";
import { UndoProvider } from "@/lib/undoable";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

/** Server state the fake backend keeps between requests. */
let notes: Record<string, unknown>[];
let projects: { id: number; name: string; state: string; position: number }[];
let nextId: number;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

// Mimics the real API closely enough to exercise the two things that matter
// here: "#name" creating a project on the fly, and clearProject detaching.
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";

  if (url.includes("/projects") && method === "GET") return Promise.resolve(jsonResponse(projects));
  if (url.includes("/contexts") && method === "GET") return Promise.resolve(jsonResponse([]));
  if (url.includes("/notes") && method === "GET") return Promise.resolve(jsonResponse(notes));

  if (url.includes("/notes") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    let projectId = body.projectId as number | undefined;
    if (!projectId && body.projectName) {
      const created = {
        id: nextId++,
        name: body.projectName,
        state: "active",
        position: projects.length + 1,
      };
      projects = [...projects, created];
      projectId = created.id;
    }
    const note = {
      id: nextId++,
      projectId,
      body: body.body,
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
    };
    notes = [...notes, note];
    return Promise.resolve(jsonResponse(note, 201));
  }

  if (url.includes("/notes/") && method === "DELETE") {
    const id = Number(url.split("/notes/")[1]);
    notes = notes.filter((n) => n.id !== id);
    return Promise.resolve(jsonResponse({}, 204));
  }

  if (url.includes("/notes/") && method === "PUT") {
    const id = Number(url.split("/notes/")[1]);
    const body = JSON.parse(String(init?.body ?? "{}"));
    notes = notes.map((n) => {
      if (n.id !== id) return n;
      if (body.clearProject) return { ...n, projectId: undefined };
      if (body.projectId) return { ...n, projectId: body.projectId };
      if (body.body) return { ...n, body: body.body };
      return n;
    });
    return Promise.resolve(jsonResponse(notes.find((n) => n.id === id)));
  }

  return Promise.resolve(jsonResponse({}, 404));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotesPage />
    </QueryClientProvider>,
  );
}

// Deleting is only deferred inside the provider.
function renderPageWithUndo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UndoProvider>
        <NotesPage />
      </UndoProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  notes = [];
  projects = [{ id: 1, name: "Car maintenance", state: "active", position: 1 }];
  nextId = 100;
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("adding a note", () => {
  // The regression: the field was a plain input, so "#" offered nothing and
  // a multi-word project could not be completed at all.
  it("completes an existing project from the # token", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("textbox", { name: /Add a note/ }));
    await user.keyboard("check tyre pressure #Car");
    // The suggestion menu offers the project; Tab completes it.
    await screen.findByText("Car maintenance");
    await user.keyboard("{Tab}{Enter}");

    await waitFor(() => expect(notes.at(-1)?.body).toBe("check tyre pressure"));
    expect(notes.at(-1)?.projectId).toBe(1);
  });

  it("creates a project named by an unknown # token", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("textbox", { name: /Add a note/ }));
    await user.keyboard("paint swatches #Redecorate{Enter}");

    await waitFor(() => expect(notes.at(-1)?.body).toBe("paint swatches"));
    expect(projects.map((p) => p.name)).toContain("Redecorate");
  });

  it("keeps a note with no # token unattached", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("textbox", { name: /Add a note/ }));
    await user.keyboard("just a thought{Enter}");

    await waitFor(() => expect(notes.at(-1)?.body).toBe("just a thought"));
    expect(notes.at(-1)?.projectId).toBeUndefined();
  });
});

describe("editing a note's text", () => {
  it("saves an edited body", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "wheel sizes", createdAt: "", updatedAt: "" }];
    renderPage();

    await user.click(await screen.findByText("wheel sizes"));
    const field = screen.getByRole("textbox", { name: "Note text" });
    await user.clear(field);
    await user.type(field, "wheel sizes: 205/55 R16");
    await user.tab(); // clicking away commits

    await waitFor(() => expect(notes[0].body).toBe("wheel sizes: 205/55 R16"));
  });

  // The reason the body is not run through the composer parser: a "#" in prose
  // is prose, not a project reference.
  it("keeps a # in the text instead of making a project of it", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "wheel sizes", createdAt: "", updatedAt: "" }];
    renderPage();

    await user.click(await screen.findByText("wheel sizes"));
    const field = screen.getByRole("textbox", { name: "Note text" });
    await user.clear(field);
    await user.type(field, "see issue #42 before ordering");
    await user.tab(); // clicking away commits

    await waitFor(() => expect(notes[0].body).toBe("see issue #42 before ordering"));
    expect(notes[0].projectId).toBeUndefined();
    expect(projects.map((p) => p.name)).not.toContain("42");
  });

  it("abandons the edit on Escape", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "wheel sizes", createdAt: "", updatedAt: "" }];
    renderPage();

    await user.click(await screen.findByText("wheel sizes"));
    await user.type(screen.getByRole("textbox", { name: "Note text" }), " and pressures{Escape}");

    expect(notes[0].body).toBe("wheel sizes");
    await screen.findByText("wheel sizes");
  });
});

describe("changing a note's project", () => {
  it("detaches from the chip without opening an editor", async () => {
    const user = userEvent.setup();
    notes = [
      { id: 5, projectId: 1, body: "wheel sizes", createdAt: "", updatedAt: "" },
    ];
    renderPage();

    await user.click(await screen.findByLabelText("Detach from Car maintenance"));

    await waitFor(() => expect(notes[0].projectId).toBeUndefined());
    // Back to the "add a project" affordance, not a dropdown.
    await screen.findByRole("button", { name: /project/i });
  });

  it("attaches an unattached note through the inline autocomplete", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "wheel sizes", createdAt: "", updatedAt: "" }];
    renderPage();

    await user.click(await screen.findByRole("button", { name: /project/i }));
    // The field takes focus with the editor, so typing starts straight away —
    // no second click, and the menu is already listing projects.
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "#project — empty to detach" }),
    );
    await screen.findByText("Car maintenance");
    await user.keyboard("Car");
    await screen.findByText("Car maintenance");
    await user.keyboard("{Tab}");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(notes[0].projectId).toBe(1));
  });
});

describe("deleting a note", () => {
  it("removes the card at once and offers an undo instead of a confirmation", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "boiler serial number", createdAt: "", updatedAt: "" }];
    renderPageWithUndo();

    await user.click(await screen.findByRole("button", { name: "Delete this note" }));

    expect(screen.queryByText("boiler serial number")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    // Nothing has left the server yet.
    expect(notes).toHaveLength(1);
  });

  it("brings the note back on undo", async () => {
    const user = userEvent.setup();
    notes = [{ id: 5, body: "boiler serial number", createdAt: "", updatedAt: "" }];
    renderPageWithUndo();

    await user.click(await screen.findByRole("button", { name: "Delete this note" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByText("boiler serial number")).toBeTruthy();
    expect(notes).toHaveLength(1);
  });
});
