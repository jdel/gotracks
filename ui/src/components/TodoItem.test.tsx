import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoItem } from "./TodoItem";
import { UndoProvider } from "@/lib/undoable";
import { LEAVE_MS } from "@/lib/motion";
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

// Completing is only deferred inside the provider; on its own the item falls
// back to committing straight away.
function renderItemWithUndo(todo: Todo = baseTodo) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UndoProvider>
        <ul>
          <TodoItem todo={todo} />
        </ul>
      </UndoProvider>
    </QueryClientProvider>,
  );
}

function completeCalls() {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
    String(c[0]).includes("/complete"),
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

  it("abandons the edit on Escape", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText("buy paint"));
    await user.type(screen.getByRole("textbox", { name: "Action description" }), " now{Escape}");

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
    await waitFor(() => expect(clip()?.classList.contains("text-done")).toBe(true));

    await user.click(screen.getByRole("button", { name: /Show attachments/ }));
    expect(clip()?.classList.contains("text-done")).toBe(true);

    await user.click(screen.getByRole("button", { name: /Hide attachments/ }));
    expect(clip()?.classList.contains("text-done")).toBe(true);
  });

  it("is not coloured for an action with no files", async () => {
    renderItem();
    await waitFor(() =>
      expect(document.querySelector(".lucide-paperclip")?.classList.contains("text-done")).toBe(
        false,
      ),
    );
  });
});

describe("completing an action", () => {
  it("offers an undo window instead of saving straight away", async () => {
    const user = userEvent.setup();
    renderItemWithUndo();

    await user.click(screen.getByRole("button", { name: "Mark this action complete" }));

    // The row already reads as done, but nothing has been written yet.
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen this action" })).toBeTruthy();
    expect(completeCalls()).toHaveLength(0);
  });

  it("un-checking the action cancels the completion", async () => {
    const user = userEvent.setup();
    renderItemWithUndo();

    await user.click(screen.getByRole("button", { name: "Mark this action complete" }));
    await user.click(screen.getByRole("button", { name: "Reopen this action" }));

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark this action complete" })).toBeTruthy();
    expect(completeCalls()).toHaveLength(0);
  });

  it("commits once the undo window closes", async () => {
    // fireEvent rather than userEvent: userEvent's own delay does not interleave
    // with fake timers here, and the click itself needs no typing behaviour.
    vi.useFakeTimers();
    try {
      renderItemWithUndo();

      fireEvent.click(screen.getByRole("button", { name: "Mark this action complete" }));
      // The 5s undo window, then the leave animation the commit waits out.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(LEAVE_MS + 50);
      });

      expect(completeCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The row actions float so a long title's first line stops at them and the rest
// runs underneath. That only works while the title is a real inline element: a
// <button> is an atomic inline box, so its text cannot split around a float and
// the whole box drops below the icons instead.
describe("a long title flowing around the row actions", () => {
  it("keeps the title inline rather than an atomic button box", async () => {
    renderItem();
    const title = await screen.findByText("buy paint");

    expect(title.tagName).toBe("SPAN");
    expect(title.closest("button")).toBeNull();
    // Still operable: it opens the inline editor by click and by keyboard.
    expect(title.getAttribute("role")).toBe("button");
    expect(title.getAttribute("tabindex")).toBe("0");
  });

  it("floats the actions inside the text column", async () => {
    renderItem();
    const title = await screen.findByText("buy paint");
    const column = title.parentElement as HTMLElement;

    const actions = column.querySelector(".float-right");
    expect(actions, "row actions are not floated inside the text column").not.toBeNull();
    expect(actions?.querySelector(".lucide-trash-2")).not.toBeNull();
  });

  it("still opens the editor from the keyboard", async () => {
    const user = userEvent.setup();
    renderItem();

    const title = await screen.findByText("buy paint");
    title.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", { name: "Action description" })).toBeTruthy();
  });
});

// A long press opens the action sheet. The sheet is position:fixed, which is
// only viewport-relative while no ancestor is transformed — and the swipeable
// row is a transform away from becoming the containing block for it. Rendered
// in place it was laid out against the card and clipped by the row's
// overflow-hidden, so it appeared as a small panel scrolling inside the card.
describe("the long-press sheet escapes the row", () => {
  function longPress(row: Element) {
    fireEvent.pointerDown(row, { pointerType: "touch", clientX: 120, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
  }

  it("renders the sheet outside the row that opened it", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderItem();
      const row = container.querySelector("li");
      expect(row).not.toBeNull();

      longPress(row!);

      const sheet = document.body.querySelector('[role="dialog"]');
      expect(sheet).not.toBeNull();
      // The whole point: not a descendant of the row, so nothing the row does
      // to its own transform or overflow can clip it.
      expect(row!.contains(sheet!)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // The row must not carry an identity transform at rest either: that alone
  // re-creates the containing block for anything fixed inside it.
  it("leaves the card untransformed when it is not being swiped", () => {
    const { container } = renderItem();
    const card = container.querySelector("li > div:nth-of-type(2)") as HTMLElement;
    expect(card.style.transform).toBe("");
  });
});

// Deleting used to be a left swipe: one horizontal drag on a list scrolled by
// thumb, and the action was gone. It defers now, and delete moved into the
// editor behind a long press and a deliberate tap.
describe("the mobile gestures", () => {
  function swipeLeft(row: Element) {
    fireEvent.pointerDown(row, { pointerType: "touch", clientX: 200, clientY: 10 });
    fireEvent.pointerMove(row, { pointerType: "touch", clientX: 180, clientY: 10 });
    fireEvent.pointerMove(row, { pointerType: "touch", clientX: 60, clientY: 10 });
    fireEvent.pointerUp(row, { pointerType: "touch", clientX: 60, clientY: 10 });
  }

  it("opens the defer sheet on a left swipe, and deletes nothing", async () => {
    const { container } = renderItemWithUndo();
    const row = container.querySelector("li")!;

    swipeLeft(row);

    // The sheet, not the web row's Defer button — both carry the same name.
    expect(await screen.findByRole("dialog", { name: "Defer" })).toBeTruthy();
    const deletes = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[1]?.method) === "DELETE",
    );
    expect(deletes).toHaveLength(0);
  });

  it("opens the editor on a long press", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderItem();
      const row = container.querySelector("li")!;

      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 120, clientY: 10 });
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // The editor, not the old three-button menu: it carries the fields.
      expect(screen.getAllByLabelText("Show from").length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: "Delete this action" }).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The tickler renders the same rows as the actions view, so an action is
// edited identically from either — there are no tickler-specific controls.
describe("editing an action's dates", () => {
  it("sends both dates together, with the show-from carried along", async () => {
    const user = userEvent.setup();
    renderItem({ ...baseTodo, due: "2026-09-10T00:00:00Z", showFrom: "2026-09-03T00:00:00Z" });

    await user.click(screen.getByLabelText("Edit this action"));
    fireEvent.change(screen.getAllByLabelText("Due")[0], { target: { value: "2026-09-24" } });
    fireEvent.blur(screen.getAllByLabelText("Due")[0], { target: { value: "2026-09-24" } });

    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(put).toBeTruthy();
      // Two weeks later, and the show-from moved by the same fortnight.
      expect(JSON.parse(String(put![1].body))).toMatchObject({
        due: "2026-09-24",
        showFrom: "2026-09-17",
      });
    });
  });
});

// Safari reads a swipe starting at the screen edge as back/forward and will not
// let JavaScript cancel it. Rather than fight for those pixels and win only
// sometimes, the row concedes them: the browser owns a thumb's width at each
// side, the row owns the middle.
describe("the screen edges belong to the browser", () => {
  it("ignores a gesture that starts at the edge", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderItem();
      const row = container.querySelector("li")!;

      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 4, clientY: 10 });
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // No editor: the press was never ours to act on.
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("acts on a gesture that starts away from the edge", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderItem();
      const row = container.querySelector("li")!;

      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 300, clientY: 10 });
      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The paperclip is the one row icon a phone keeps: the other actions are
// gestures there, but no gesture reaches attachments. On a phone the panel
// opens as a sheet rather than inline, where it would push the rest of the
// list off screen and squeeze file names into a narrow column.
describe("attachments on a phone", () => {
  it("opens the attachment panel in a sheet", async () => {
    const user = userEvent.setup();
    attachments = [{ id: 9, todoId: 7, fileName: "invoice.pdf", size: 2048, createdAt: "" }];
    renderItem();

    await user.click(screen.getByLabelText(/attachments/i));

    // Scoped to the sheet: the desktop copy of the panel is hidden by CSS,
    // which jsdom does not apply, so it is still in the tree.
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toContain("invoice.pdf");
    // Deleting a single file is reachable from there, not only from the
    // account-wide attachments page.
    expect(within(sheet).getByLabelText(/Delete invoice.pdf/)).toBeTruthy();
  });
});

// The grabber at the top of a sheet promises it can be pulled down. It can:
// dragging past a threshold dismisses, and anything shorter springs back
// rather than leaving the sheet sitting half-open.
describe("pulling a sheet down", () => {
  function openSheet() {
    const { container } = renderItem();
    const row = container.querySelector("li")!;
    fireEvent.pointerDown(row, { pointerType: "touch", clientX: 120, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    return screen.getByRole("dialog");
  }

  function drag(sheet: Element, distance: number) {
    fireEvent.pointerDown(sheet, { pointerType: "touch", clientY: 100 });
    fireEvent.pointerMove(sheet, { pointerType: "touch", clientY: 100 + distance });
    fireEvent.pointerUp(sheet, { pointerType: "touch", clientY: 100 + distance });
  }

  it("dismisses when pulled past the threshold", () => {
    vi.useFakeTimers();
    try {
      drag(openSheet(), 200);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("springs back after a short pull", () => {
    vi.useFakeTimers();
    try {
      const sheet = openSheet();
      drag(sheet, 20);
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect((sheet as HTMLElement).style.transform).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  // Lower down a long sheet, a downward drag is someone scrolling back up.
  it("leaves the gesture to the content when it is scrolled down", () => {
    vi.useFakeTimers();
    try {
      const sheet = openSheet();
      Object.defineProperty(sheet, "scrollTop", { value: 120, configurable: true });
      drag(sheet, 200);
      expect(screen.getByRole("dialog")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
