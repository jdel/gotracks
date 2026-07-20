import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DonePage } from "./ListPages";

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

function todo(id: number, description: string, starred = false) {
  return {
    id,
    contextId: 1,
    description,
    tags: [],
    notes: "",
    state: "completed",
    starred,
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
      <DonePage />
    </QueryClientProvider>,
  );
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
