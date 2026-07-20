import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsPage } from "./ProjectsPage";

let projects: Record<string, unknown>[];
let created: string[];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";
  if (url.includes("/projects") && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    created.push(body.name);
    const p = { id: 99, name: body.name, state: "active", position: 9, openCount: 0 };
    projects = [...projects, p];
    return Promise.resolve(jsonResponse(p, 201));
  }
  if (url.includes("/projects")) return Promise.resolve(jsonResponse(projects));
  if (url.includes("/preferences")) return Promise.resolve(jsonResponse({}, 401));
  return Promise.resolve(jsonResponse({}, 404));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  projects = [
    { id: 1, name: "Kitchen remodel", state: "active", position: 1, openCount: 2 },
    { id: 2, name: "Tax return", state: "active", position: 2, openCount: 0 },
  ];
  created = [];
  localStorage.setItem("gt.access", "test-token");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("projects page", () => {
  it("filters the list", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Kitchen remodel");
    await user.type(screen.getByLabelText("Filter projects"), "tax");

    await waitFor(() => expect(screen.queryByText("Kitchen remodel")).toBeNull());
    expect(screen.getByText("Tax return")).toBeDefined();
  });

  it("adds a project from the mobile sheet and closes it", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Kitchen remodel");
    await user.click(screen.getByLabelText("Add a project"));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText(/New project/), "Garden");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(created).toContain("Garden"));
    // The sheet closes on success.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
