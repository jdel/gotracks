import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DonePage, TicklerPage } from "./ListPages";
import { browserTimeZone, formatWeekday } from "@/lib/datefmt";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

let todos: Record<string, unknown>[];
let attachments: Record<string, unknown>[];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, blob: async () => new Blob() } as Response;
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/contexts")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/tags")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/attachments")) return Promise.resolve(jsonResponse(attachments));
  if (url.includes("/preferences")) return Promise.resolve(jsonResponse({}, 401));
  if (url.includes("/todos")) return Promise.resolve(jsonResponse(todos));
  return Promise.resolve(jsonResponse({}, 404));
}

function todo(id: number, description: string, starred = false, completedAt?: string) {
  return {
    id,
    contextId: 1,
    description,
    tags: [],
    notes: "",
    state: "completed",
    starred,
    completedAt,
    position: id,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
  };
}

function renderPage(page: "done" | "tickler" = "done") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {page === "tickler" ? <TicklerPage /> : <DonePage />}
    </QueryClientProvider>,
  );
}

// A deferred action waiting in the tickler, with the show-from it waits for.
function deferred(id: number, description: string, showFrom: string) {
  return {
    id,
    contextId: 1,
    description,
    tags: [],
    notes: "",
    state: "deferred",
    starred: false,
    showFrom,
    position: id,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  todos = [todo(1, "shipped the release", true), todo(2, "archived old files"), todo(3, "wrote the notes")];
  // Only todo 2 has an attachment.
  attachments = [{ id: 9, todoId: 2, fileName: "old.zip", size: 10, createdAt: "" }];
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("done archive filters", () => {
  it("searches completed actions", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("shipped the release");
    await user.type(screen.getByLabelText("Filter actions"), "notes");

    await waitFor(() => expect(screen.queryByText("shipped the release")).toBeNull());
    expect(screen.getByText("wrote the notes")).toBeDefined();
  });

  it("filters to actions that have files", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("archived old files");
    // Cycle the files switch all -> on.
    await user.click(screen.getByRole("button", { name: /Files:/ }));

    await waitFor(() => expect(screen.queryByText("shipped the release")).toBeNull());
    expect(screen.getByText("archived old files")).toBeDefined();
  });

  it("filters to starred actions", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("shipped the release");
    await user.click(screen.getByRole("button", { name: /Starred:/ }));

    expect(screen.getByText("shipped the release")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("wrote the notes")).toBeNull());
  });
});

// The archive is read by "when did I finish this", so the rows carry a heading
// per completion day rather than running together.
describe("done archive grouping", () => {
  it("puts a dated heading over each day's actions", async () => {
    const zone = browserTimeZone();
    todos = [
      todo(1, "file taxes", false, "2026-08-05T12:00:00Z"),
      todo(2, "call plumber", false, "2026-08-03T12:00:00Z"),
      todo(3, "book train", false, "2026-08-03T12:00:00Z"),
    ];
    renderPage();

    await screen.findByText("file taxes");
    expect(screen.getByText(formatWeekday("2026-08-05T12:00:00Z", zone))).toBeTruthy();
    expect(screen.getByText(formatWeekday("2026-08-03T12:00:00Z", zone))).toBeTruthy();
  });

  it("groups an action with no completion date on its own", async () => {
    todos = [todo(1, "file taxes", false, "2026-08-05T12:00:00Z"), todo(2, "lost record")];
    renderPage();

    await screen.findByText("lost record");
    expect(screen.getByText("No date")).toBeTruthy();
  });
});

// The server sorts every list by position — the order the context lists are
// dragged into — so a date-grouped list has to sort for itself. Otherwise the
// headings come out in position order and one date appears more than once.
describe("tickler grouping", () => {
  it("orders the day headings by show-from, not by position", async () => {
    const zone = browserTimeZone();
    // Position order deliberately disagrees with date order, and the two
    // rows sharing a day are not adjacent.
    todos = [
      deferred(1, "renew passport", "2026-09-10T00:00:00Z"),
      deferred(2, "book dentist", "2026-08-20T00:00:00Z"),
      deferred(3, "pay tax", "2026-09-10T00:00:00Z"),
    ];
    renderPage("tickler");

    await screen.findByText("renew passport");
    const headings = screen
      .getAllByText(
        new RegExp(
          `${formatWeekday("2026-08-20T00:00:00Z", zone)}|${formatWeekday("2026-09-10T00:00:00Z", zone)}`,
        ),
      )
      .map((el) => el.textContent);
    // One heading per date, earliest first.
    expect(headings).toEqual([
      formatWeekday("2026-08-20T00:00:00Z", zone),
      formatWeekday("2026-09-10T00:00:00Z", zone),
    ]);
  });
});
