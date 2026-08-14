import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecurringPage } from "./RecurringPage";
import { mockApi, type MockApi } from "@/test/api";
import { renderWithProviders } from "@/test/render";
import { aContext, aProject, aRecurrence } from "@/test/fixtures";
import type { RecurringTodo } from "@/lib/types";

/**
 * The recurrence page had no tests and two forms — an add bar and an edit
 * dialog — which is how editing came to be unable to change a context or a
 * project at all. Every case here runs against **both** ways into the one form
 * that replaced them, so they cannot drift apart again.
 */

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

let patterns: RecurringTodo[];
let api: MockApi;

const pattern = aRecurrence;

beforeEach(() => {
  patterns = [aRecurrence()];
  localStorage.setItem("gt.access", "test-token");
  api = mockApi({
    "GET /contexts": [aContext({ id: 1, name: "home" }), aContext({ id: 2, name: "office" })],
    "GET /projects": [aProject({ id: 5, name: "garden" }), aProject({ id: 6, name: "taxes" })],
    "GET /recurring": () => patterns,
    "POST /recurring": () => aRecurrence({ id: 99 }),
    "PUT /recurring/:id": () => patterns[0],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const renderPage = (viewport: "phone" | "desktop" = "desktop") =>
  renderWithProviders(<RecurringPage />, { viewport, undo: true });

/** The add form at the top of the page, and the editor opened on the pattern. */
async function openForm(kind: "add" | "edit", user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("water the plants");
  // The composer has no placeholder attribute — the text is drawn by the
  // highlight mirror behind the field — so the field is labelled with it.
  if (kind === "add") return document.querySelector<HTMLElement>("form.space-y-3")!;
  await user.click(screen.getByRole("button", { name: "Edit this recurrence" }));
  // The editor is not a <form> — a stray submit would dismiss it — so the row
  // it expands inside is the container to scope queries to.
  return screen.getByRole("listitem");
}

const lastBody = () => api.lastBody() as Record<string, unknown>;

describe.each(["add", "edit"] as const)("the %s form", (kind) => {
  const creating = kind === "add";

  it("sends the schedule it shows", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm(kind, user);

    if (creating) await user.type(within(form).getByLabelText(/Recurring action/i), "call the vet");
    await user.selectOptions(within(form).getByLabelText("Repeats"), "monthly");
    // Selecting the digit rather than clearing it: the field floors itself at
    // 1, so an empty box immediately becomes "1" and typing would append.
    await user.type(within(form).getByLabelText("Every"), "3", {
      initialSelectionStart: 0,
      initialSelectionEnd: 1,
    });
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes().length).toBeGreaterThan(0));
    expect(lastBody()).toMatchObject({ period: "monthly", everyN: 3 });
    expect(api.writes().at(-1)!.method).toBe(creating ? "POST" : "PUT");
  });

  it("files it under the chosen context and project", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm(kind, user);

    if (creating) await user.type(within(form).getByLabelText(/Recurring action/i), "call the vet");
    // Both pickers are typed into: type to filter, arrow, Enter.
    await user.click(within(form).getByLabelText("Context"));
    await user.click(await screen.findByRole("button", { name: "office" }));
    await user.click(within(form).getByLabelText("Project"));
    await user.click(await screen.findByRole("button", { name: "taxes" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // Editing could not do this at all before: the dialog had no context or
    // project control, so a pattern was stuck wherever it was created.
    await waitFor(() => expect(lastBody()).toMatchObject({ contextId: 2, projectId: 6 }));
  });

  it("sends the tags the actions it spawns will inherit", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm(kind, user);

    if (creating) await user.type(within(form).getByLabelText(/Recurring action/i), "call the vet");
    await user.type(within(form).getByLabelText("Tags (comma separated)"), "pets, Vet");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // Normalised the same way an action's are, so a tag means one thing in
    // both places.
    await waitFor(() => expect(lastBody()).toMatchObject({ tags: ["pets", "vet"] }));
  });

  it("round-trips the window and refuses one that closes before it opens", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm(kind, user);

    if (creating) await user.type(within(form).getByLabelText(/Recurring action/i), "call the vet");
    // A date input is filled, not typed into: jsdom takes the value whole.
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "2026-09-01" } });
    fireEvent.change(within(form).getByLabelText("Ends"), { target: { value: "2026-08-01" } });
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(within(form).getByText(/cannot be before/)).toBeTruthy();
    expect(api.writes()).toEqual([]);

    fireEvent.change(within(form).getByLabelText("Ends"), { target: { value: "2026-10-01" } });
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(lastBody()).toMatchObject({ startFrom: "2026-09-01", endDate: "2026-10-01" }),
    );
  });
});

describe("editing a pattern", () => {
  it("writes nothing until Save", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.clear(within(form).getByLabelText(/Recurring action/i));
    await user.type(within(form).getByLabelText(/Recurring action/i), "water them twice");

    expect(api.writes()).toEqual([]);
  });

  it("discards the draft when the editor is closed", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.clear(within(form).getByLabelText(/Recurring action/i));
    await user.type(within(form).getByLabelText(/Recurring action/i), "water them twice");
    await user.click(screen.getByRole("button", { name: "Edit this recurrence" }));

    expect(api.writes()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeTruthy(); // the add form's
    expect(screen.getByText("water the plants")).toBeTruthy();
  });

  it("clears the end date with an empty string rather than leaving it alone", async () => {
    patterns = [pattern({ endDate: "2026-12-01T00:00:00Z" })];
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.click(within(form).getByRole("button", { name: "Clear the end date" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // "" is the clear; undefined would mean "leave unchanged" and the end date
    // would quietly survive being removed.
    await waitFor(() => expect(lastBody()).toMatchObject({ endDate: "" }));
  });

  it("clears the start date the same way, not by omitting it", async () => {
    patterns = [pattern({ startFrom: "2026-01-01T00:00:00Z" })];
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.click(within(form).getByRole("button", { name: "Clear the start date" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(lastBody()).toMatchObject({ startFrom: "" }));
  });

  it("detaches from a project out loud", async () => {
    patterns = [pattern({ projectId: 5 })];
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.click(within(form).getByLabelText("Project"));
    await user.click(await screen.findByRole("button", { name: "No project" }));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // A missing projectId reads as "leave unchanged" on the wire, so removing
    // one has to be said explicitly or nothing happens.
    await waitFor(() => expect(lastBody()).toMatchObject({ clearProject: true }));
  });
});

describe("the weekday picker", () => {
  it("keeps a selected day the same size as an unselected one", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("add", user);

    // Asserting on classes, which this suite otherwise avoids: the defect is
    // two pixels of width, jsdom has no layout engine to measure it with, and
    // no browser runner is installed here. The border is what moves — a filled
    // button had none and an outlined one did, so a day changed width as it was
    // clicked.
    const monday = within(form).getByRole("button", { name: "Mon" });
    const tuesday = within(form).getByRole("button", { name: "Tue" });
    const borderWidth = (el: HTMLElement) =>
      [...el.classList].filter((c) => c === "border" || c.startsWith("border-[")).join(" ");

    expect(borderWidth(monday)).toBe(borderWidth(tuesday));
    await user.click(tuesday);
    expect(borderWidth(within(form).getByRole("button", { name: "Tue" }))).toBe(
      borderWidth(within(form).getByRole("button", { name: "Mon" })),
    );
  });
});

describe("tags on a pattern", () => {
  it("shows the pattern's own tags in the list and in the editor", async () => {
    patterns = [pattern({ tags: ["garden", "weekly"] })];
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("!garden")).toBeTruthy();
    const form = await openForm("edit", user);
    expect((within(form).getByLabelText("Tags (comma separated)") as HTMLInputElement).value).toBe(
      "garden, weekly",
    );
  });

  it("clears them with an empty set rather than by saying nothing", async () => {
    patterns = [pattern({ tags: ["garden"] })];
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("edit", user);

    await user.clear(within(form).getByLabelText("Tags (comma separated)"));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // An absent field means "leave them alone", so removing the last tag has
    // to be an empty array rather than silence.
    await waitFor(() => expect(lastBody()).toMatchObject({ tags: [] }));
  });

  it("reads a !tag typed into the composer when adding", async () => {
    const user = userEvent.setup();
    renderPage();
    const form = await openForm("add", user);

    await user.type(within(form).getByLabelText(/Recurring action/i), "call the vet !pets");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(lastBody()).toMatchObject({ description: "call the vet", tags: ["pets"] }),
    );
  });
});

describe("where the editor opens", () => {
  it("expands inside the card on a desktop", async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm("edit", user);

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(screen.getAllByLabelText("Context").length).toBe(2); // add form + editor
  });

  // The class, not the click: `isDesktop` used to decide whether the pencil
  // rendered at all, and jsdom answers media queries only when a test says so —
  // so a click test would pass against a pencil no phone user is given.
  it("renders the pencil at a phone width", async () => {
    renderPage("phone");
    await screen.findByText("water the plants");

    expect(screen.getByRole("button", { name: "Edit this recurrence" })).toBeTruthy();
  });

  it("opens as a sheet on a phone, from the same pencil", async () => {
    const user = userEvent.setup();
    renderPage("phone");
    await screen.findByText("water the plants");

    // The row used to be held instead. A hold is the browser's own "select this
    // text" gesture, and it put iOS's selection handles over the editor.
    await user.click(screen.getByRole("button", { name: "Edit this recurrence" }));

    await waitFor(() => expect(document.querySelector("[role='dialog']")).not.toBeNull());
  });
});
