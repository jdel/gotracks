import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoItem } from "./TodoItem";
import type { Todo } from "@/lib/types";

let todos: Record<string, unknown>[];
let attachments: Record<string, unknown>[];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";

  if (url.includes("/contexts")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/projects")) return Promise.resolve(jsonResponse([]));
  if (url.includes("/preferences")) return Promise.resolve(jsonResponse({}));
  // The per-todo list and the account-wide one share a prefix; order matters.
  if (url.includes("/todos/") && url.includes("/attachments")) {
    return Promise.resolve(jsonResponse(attachments));
  }
  if (url.includes("/attachments")) return Promise.resolve(jsonResponse(attachments));

  if (url.includes("/todos/") && method === "PUT") {
    const id = Number(url.split("/todos/")[1]);
    const body = JSON.parse(String(init?.body ?? "{}"));
    todos = todos.map((t) => (t.id === id ? { ...t, ...body } : t));
    return Promise.resolve(jsonResponse(todos.find((t) => t.id === id)));
  }
  if (url.includes("/todos")) return Promise.resolve(jsonResponse(todos));

  return Promise.resolve(jsonResponse({}, 404));
}

const baseTodo: Todo = {
  id: 7,
  contextId: 1,
  description: "buy paint",
  notes: "",
  state: "active",
  starred: false,
  position: 1,
  tags: [],
  createdAt: "2026-07-20T00:00:00Z",
  updatedAt: "2026-07-20T00:00:00Z",
};

function renderItem(todo: Todo = baseTodo) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <TodoItem todo={todo} />
      </ul>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  todos = [{ ...baseTodo }];
  attachments = [];
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("editing an action inline", () => {
  it("saves an edited description", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText("buy paint"));
    const field = screen.getByRole("textbox", { name: "Action description" });
    await user.clear(field);
    await user.type(field, "buy emulsion{Enter}");

    await waitFor(() => expect(todos[0].description).toBe("buy emulsion"));
  });

  // The reason the description is not run back through the composer parser.
  it("keeps a # in the description instead of making a project of it", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText("buy paint"));
    const field = screen.getByRole("textbox", { name: "Action description" });
    await user.clear(field);
    await user.type(field, "call about invoice #7741{Enter}");

    await waitFor(() => expect(todos[0].description).toBe("call about invoice #7741"));
    expect(todos[0].projectName).toBeUndefined();
  });

  it("abandons the edit on cancel", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText("buy paint"));
    await user.type(screen.getByRole("textbox", { name: "Action description" }), " now");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(todos[0].description).toBe("buy paint");
    await screen.findByText("buy paint");
  });
});

describe("the attachment indicator", () => {
  // The regression: expanding the panel used to overwrite the "has files"
  // colour with the open-state tint, so the marker vanished on click.
  it("stays coloured while the panel is open", async () => {
    const user = userEvent.setup();
    attachments = [{ id: 1, todoId: 7, fileName: "swatch.png", size: 10, createdAt: "" }];
    renderItem();

    const clip = () => document.querySelector(".lucide-paperclip");
    await waitFor(() => expect(clip()?.classList.contains("text-sky-600")).toBe(true));

    await user.click(screen.getByRole("button", { name: /Show attachments/ }));
    expect(clip()?.classList.contains("text-sky-600")).toBe(true);

    await user.click(screen.getByRole("button", { name: /Hide attachments/ }));
    expect(clip()?.classList.contains("text-sky-600")).toBe(true);
  });

  it("is not coloured for an action with no files", async () => {
    renderItem();
    await waitFor(() =>
      expect(document.querySelector(".lucide-paperclip")?.classList.contains("text-sky-600")).toBe(
        false,
      ),
    );
  });
});
