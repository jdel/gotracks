import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoItem } from "./TodoItem";
import { SwipeRow } from "./SwipeRow";
import { Sheet } from "./primitives";
import { setViewport } from "@/test/viewport";
import { UndoProvider } from "@/lib/undoable";
import { LEAVE_MS } from "@/lib/motion";
import type { Todo } from "@/lib/types";

let todos: Record<string, unknown>[];
/** Contexts the fake server knows about. Empty unless a test needs them. */
let contexts: Record<string, unknown>[];
let attachments: Record<string, unknown>[];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

/** Attachment ids the fake server has been asked to delete, in order. */
let deletedIds: number[];
/** Ids the fake server refuses to delete, so partial failure can be tested. */
const failDelete = new Set<number>();
const deleted = () => deletedIds;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";

  if (method === "DELETE" && /\/attachments\/\d+$/.test(url)) {
    const id = Number(url.split("/attachments/")[1]);
    deletedIds.push(id);
    if (failDelete.has(id)) {
      return Promise.resolve(jsonResponse({ error: "attachment in use" }, 409));
    }
    return Promise.resolve(jsonResponse({}, 204));
  }

  if (url.includes("/contexts")) return Promise.resolve(jsonResponse(contexts));
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
  contexts = [];
  attachments = [];
  deletedIds = [];
  failDelete.clear();
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

    // The sheet is modal, so the row behind it is inert — the panel is closed
    // from the sheet, not by reaching through it.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

/**
 * Completing an action that has attachments offers to delete them. That offer
 * used to run `Promise.all` and clear its busy flag afterwards, so one refused
 * delete left the dialog spinning and stuck, with the successful deletions
 * already gone from the server but still on screen.
 */
describe("clearing attachments after completing", () => {
  /** Completes the action and waits out the undo window and the animation. */
  async function completeAndWait() {
    vi.useFakeTimers();
    try {
      renderItemWithUndo();
      fireEvent.click(screen.getByRole("button", { name: "Mark this action complete" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(LEAVE_MS + 50);
      });
    } finally {
      vi.useRealTimers();
    }
  }

  beforeEach(() => {
    attachments = [
      { id: 21, todoId: 7, fileName: "swatch.png", size: 10, createdAt: "" },
      { id: 22, todoId: 7, fileName: "invoice.pdf", size: 20, createdAt: "" },
    ];
  });

  it("closes when every attachment is deleted", async () => {
    await completeAndWait();
    const user = userEvent.setup();

    expect(await screen.findByText("Delete its attachments?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Delete its attachments?")).toBeNull());
    expect(deleted()).toEqual([21, 22]);
  });

  it("stays open and offers to retry the ones that failed", async () => {
    failDelete.add(22);
    await completeAndWait();
    const user = userEvent.setup();

    expect(await screen.findByText("Delete its attachments?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Both were attempted — allSettled does not cancel the rest — and the one
    // that refused is reported rather than swallowed as an unhandled rejection.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("in use"));
    expect(deleted()).toEqual([21, 22]);
    // Not stuck: the button is live again, and now means the remainder.
    const retry = screen.getByRole("button", { name: "Retry the 1 that failed" });
    expect(retry.hasAttribute("disabled")).toBe(false);

    failDelete.clear();
    await user.click(retry);

    await waitFor(() => expect(screen.queryByText("Delete its attachments?")).toBeNull());
    expect(deleted()).toEqual([21, 22, 22]);
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
      expect(screen.getByLabelText("Show from")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Delete this action" })).toBeTruthy();
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
    const due = within(screen.getByRole("dialog")).getByLabelText("Due");
    fireEvent.change(due, { target: { value: "2026-09-24" } });
    fireEvent.blur(due, { target: { value: "2026-09-24" } });
    // Nothing is written until Save — a due date is usually half an edit
    // whose other half is the show-from.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

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
    // The header is the grip: the panel below it scrolls, so it cannot also
    // own a downward drag.
    const grip = sheet.querySelector("[data-sheet-grip]")!;
    fireEvent.pointerDown(grip, { pointerType: "touch", clientY: 100 });
    fireEvent.pointerMove(grip, { pointerType: "touch", clientY: 100 + distance });
    fireEvent.pointerUp(grip, { pointerType: "touch", clientY: 100 + distance });
  }

  // Let go past the threshold and the sheet finishes the journey it was
  // already making, rather than blinking away from under the finger.
  it("slides the rest of the way out, then dismisses", async () => {
    vi.useFakeTimers();
    try {
      const sheet = openSheet();
      drag(sheet, 200);

      // Still there, and travelling: the transform is now well past the drag.
      expect(screen.getByRole("dialog")).toBeTruthy();
      const travelled = Number(
        /translateY\((\d+)px\)/.exec((sheet as HTMLElement).style.transform)?.[1] ?? 0,
      );
      expect(travelled).toBeGreaterThan(200);

      act(() => {
        vi.advanceTimersByTime(LEAVE_MS);
      });
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

  // The body scrolls, so it cannot also own a downward drag: a browser that
  // reads the drag as a scroll takes the gesture and cancels the pointer, and
  // the sheet follows the finger a few pixels and snaps back. Only the header
  // starts a pull.
  it("ignores a drag that starts on the scrolling body", () => {
    vi.useFakeTimers();
    try {
      const sheet = openSheet();
      fireEvent.pointerDown(sheet, { pointerType: "touch", clientY: 100 });
      fireEvent.pointerMove(sheet, { pointerType: "touch", clientY: 400 });
      fireEvent.pointerUp(sheet, { pointerType: "touch", clientY: 400 });

      expect(screen.getByRole("dialog")).toBeTruthy();
      expect((sheet as HTMLElement).style.transform).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

// A sheet slides over the page; the page must not slide with it. Without the
// lock, dragging the sheet down — or scrolling inside it past its end — scrolls
// the list behind instead.
describe("a sheet freezes the page behind it", () => {
  it("locks body scrolling while open and restores it after", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    // The dialog primitive owns the lock; this is the mark it leaves.
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.hasAttribute("data-scroll-locked")).toBe(false));
  });
});

// The editor's footer button both saves and dismisses. Closing an editor and
// finding the pending date edit gone is the one outcome nobody wants, so the
// button that dismisses it is the button that saves.
describe("the editor's Save button", () => {
  it("writes the pending date edit and closes", async () => {
    const user = userEvent.setup();
    renderItem({ ...baseTodo, due: "2026-09-10T00:00:00Z", showFrom: "2026-09-03T00:00:00Z" });

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "1 day before" }));
    // Still nothing written: the tap only built up the edit.
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      ),
    ).toHaveLength(0);

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(JSON.parse(String(put![1].body))).toMatchObject({ showFrom: "2026-09-09" });
    });
    // And it is gone: no Close button left behind to press separately.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

// Tapping the sheet's own title is not a request to save. It used to be read
// as one: the blur committed the dates, the action stopped matching the list
// it came from, and the row — with the open sheet inside it — was unmounted
// out from under the user.
describe("tapping around inside the editor", () => {
  it("keeps the sheet open when the title is clicked mid-edit", async () => {
    const user = userEvent.setup();
    renderItem({ ...baseTodo, state: "deferred", showFrom: "2026-09-03T00:00:00Z" });

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("heading", { name: baseTodo.description }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      ),
    ).toHaveLength(0);
  });

  // Star and delete moved onto the title row, as icons.
  it("offers star and delete beside the title", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));

    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByLabelText("Star this action")).toBeTruthy();
    expect(within(sheet).getByLabelText("Delete this action")).toBeTruthy();
  });
});

// Save means something only if there is a way not to save. Dismissing the
// editor — the backdrop, Escape, a pull-down — throws the edit away, so an
// edit begun by accident has an exit.
describe("discarding an edit", () => {
  it("writes nothing when the sheet is dismissed", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("Tags (comma separated)"), "errand");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tomorrow" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      ),
    ).toHaveLength(0);
  });

  // One request for the whole screenful, rather than one per field as each
  // was left.
  it("sends every change in a single request on Save", async () => {
    const user = userEvent.setup();
    renderItem();
    const sheet = () => screen.getByRole("dialog");

    await user.click(screen.getByLabelText("Edit this action"));
    await user.type(within(sheet()).getByLabelText("Tags (comma separated)"), "errand");
    // Scoped to the sheet: the desktop copy of the editor is hidden by CSS,
    // which jsdom does not apply, so it is a second live instance with its own
    // draft.
    await user.click(within(sheet()).getByRole("button", { name: "Tomorrow" }));
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const puts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(puts).toHaveLength(1);
      const body = JSON.parse(String(puts[0][1].body));
      expect(body.tags).toEqual(["errand"]);
      expect(body.due).toBeTruthy();
    });
  });

  it("keeps Save inert until something actually changes", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    await user.click(within(sheet).getByRole("button", { name: "Tomorrow" }));
    expect(within(sheet).getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
    expect(within(sheet).getByText("Unsaved changes")).toBeTruthy();
  });
});

// An action's description is edited in place, by clicking its title in the row.
// The editor deliberately has no field for it: two ways to change one thing,
// and only one of them shows the result where the user will read it. It also
// removes the hazard that made add and edit differ — re-parsing a stored
// description would have turned "invoice #7741" into a project named 7741.
describe("the editor does not edit the description", () => {
  it("has no description field", async () => {
    const user = userEvent.setup();
    renderItem({ ...baseTodo, description: "call about invoice #7741" });

    await user.click(screen.getByLabelText("Edit this action"));

    expect(screen.queryByLabelText("Action description")).toBeNull();
  });

  it("leaves the description alone when other fields are saved", async () => {
    const user = userEvent.setup();
    renderItem({ ...baseTodo, description: "call about invoice #7741" });

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1].body));
      expect(body.description).toBeUndefined();
      expect(body.projectName).toBeUndefined();
    });
  });
});

// The editor closes when it is saved, so any stray submit dismissed it — a
// button that forgot its type, a keystroke a control passed on, a browser
// deciding a lone field meant implicit submission. There is no form around the
// editor at all now, so no such path exists: only Save closes it.
describe("nothing but Save closes the editor", () => {
  it("has no form to submit", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const sheet = screen.getByRole("dialog");

    expect(sheet.querySelector("form")).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Save" }).getAttribute("type")).toBe("button");
  });

  it("stays open when Enter is pressed in a field", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const sheet = screen.getByRole("dialog");
    await user.type(within(sheet).getByLabelText("Tags (comma separated)"), "errand{Enter}");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      ),
    ).toHaveLength(0);
  });
});

// The dialog's own "did that land outside?" heuristic is refused, because it
// misjudges a sheet: a native select or date picker, or a pointer captured by
// the swipeable row underneath, retargets the event away from the panel and the
// sheet dismisses itself under a tap that was plainly inside it. So the ways
// out are explicit, and each one has to keep working.
describe("what dismisses a sheet", () => {
  it("closes on the backdrop", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const overlay = document.querySelector("[data-radix-dialog-overlay], [data-state=open].fixed.inset-0");
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not close when a select inside it is used", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const sheet = screen.getByRole("dialog");
    // A picker retargets the pointer; the sheet must survive it. The picker is
    // itself a dialog, so the sheet is named to tell them apart.
    fireEvent.pointerDown(document.body, { pointerType: "touch", clientX: 5, clientY: 5 });
    fireEvent.click(within(sheet).getByLabelText("Context"));

    expect(screen.getByRole("dialog", { name: baseTodo.description })).toBeTruthy();
  });
});

// Contexts and projects are typed into rather than scrolled through.
describe("choosing a context while editing", () => {
  it("filters the list and files the action under the choice", async () => {
    const user = userEvent.setup();
    contexts = [
      { id: 1, name: "@home", state: "active", position: 1 },
      { id: 2, name: "@calls", state: "active", position: 2 },
      { id: 3, name: "@errands", state: "active", position: 3 },
    ];
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    const sheet = screen.getByRole("dialog", { name: baseTodo.description });
    await user.click(within(sheet).getByLabelText("Context"));
    await user.type(screen.getByLabelText("Filter contexts"), "call");

    expect(screen.queryByRole("button", { name: "errands" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "calls" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(JSON.parse(String(put![1].body))).toMatchObject({ contextId: 2 });
    });
  });
});

// A sheet is portalled, but React propagates its events through the component
// tree — so a swipe across an open sheet reached the swipeable row underneath
// it: dragging left starred the action, dragging right threw the defer sheet on
// top of the editor.
describe("gestures inside a sheet stay inside it", () => {
  function Harness({ onSwipeLeft, onSwipeRight }: { onSwipeLeft: () => void; onSwipeRight: () => void }) {
    return (
      <ul>
        <SwipeRow onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} onLongPress={() => {}}>
          <Sheet open onClose={() => {}} title="editor">
            <button type="button">field</button>
          </Sheet>
        </SwipeRow>
      </ul>
    );
  }

  it("does not reach the row's swipe handlers", () => {
    const left = vi.fn();
    const right = vi.fn();
    render(<Harness onSwipeLeft={left} onSwipeRight={right} />);
    const sheet = screen.getByRole("dialog");

    fireEvent.pointerDown(sheet, { pointerType: "touch", clientX: 300, clientY: 400 });
    fireEvent.pointerMove(sheet, { pointerType: "touch", clientX: 120, clientY: 400 });
    fireEvent.pointerUp(sheet, { pointerType: "touch", clientX: 120, clientY: 400 });

    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });
});

// A sheet renders through a portal, so a `md:hidden` wrapper cannot hide it: a
// desktop opening any of these got the inline panel *and* a modal sheet over
// the top of it, trapping focus and locking the page. The presentation is
// chosen now, and exactly one of the two mounts.
describe("one presentation per viewport", () => {
  it("edits inline on a desktop, with no dialog", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Tags (comma separated)")).toBeTruthy();
  });

  it("edits in a sheet on a phone, with no inline copy", async () => {
    const user = userEvent.setup();
    setViewport("phone");
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // One editor, not two: the inline copy is not mounted at all.
    expect(screen.getAllByLabelText("Tags (comma separated)")).toHaveLength(1);
  });

  it("defers inline on a desktop, with no dialog", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Defer"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Due")).toBeTruthy();
  });

  it("defers in a sheet on a phone", async () => {
    const user = userEvent.setup();
    setViewport("phone");
    renderItem();

    await user.click(screen.getByLabelText("Defer"));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByLabelText("Due")).toHaveLength(1);
  });

  it("shows attachments inline on a desktop, with no dialog", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    attachments = [{ id: 9, todoId: 7, fileName: "invoice.pdf", size: 2048, createdAt: "" }];
    renderItem();

    await user.click(screen.getByLabelText(/attachments/i));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("invoice.pdf")).toBeTruthy();
  });

  it("shows attachments in a sheet on a phone", async () => {
    const user = userEvent.setup();
    setViewport("phone");
    attachments = [{ id: 9, todoId: 7, fileName: "invoice.pdf", size: 2048, createdAt: "" }];
    renderItem();

    await user.click(screen.getByLabelText(/attachments/i));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("invoice.pdf")).toBeTruthy();
  });
});

// Attachments, defer and the editor were three independent flags, so opening
// each in turn left all three stacked down the row. Only one of them can be the
// thing being worked on.
describe("one panel at a time", () => {
  it("replaces the open panel rather than stacking", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    attachments = [{ id: 9, todoId: 7, fileName: "invoice.pdf", size: 2048, createdAt: "" }];
    renderItem();

    await user.click(screen.getByLabelText(/attachments/i));
    expect(await screen.findByText("invoice.pdf")).toBeTruthy();

    await user.click(screen.getByLabelText("Defer"));
    expect(screen.queryByText("invoice.pdf")).toBeNull();
    expect(screen.getByLabelText("Due")).toBeTruthy();

    await user.click(screen.getByLabelText("Edit this action"));
    expect(screen.getByLabelText("Tags (comma separated)")).toBeTruthy();
    // The defer panel's own Save is gone with it: one panel, one Save.
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
  });

  it("closes the panel when its own control is clicked again", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Defer"));
    expect(screen.getByLabelText("Due")).toBeTruthy();

    await user.click(screen.getByLabelText("Defer"));
    expect(screen.queryByLabelText("Due")).toBeNull();
  });
});

// A panel that opens under a row left focus on the icon that opened it, so the
// next Tab went along the row's other icons instead of into the form.
describe("focus follows the panel that opens", () => {
  it("puts focus in the defer form's first field", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Defer"));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Due")));
  });

  it("puts focus in the editor's first field", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Context")));
  });

  // The add form is mounted with the page; focusing it would steal the caret.
  it("leaves focus alone when the form is used to add", async () => {
    setViewport("desktop");
    renderItem();

    expect(document.activeElement).toBe(document.body);
  });
});

// The editor has no form — a stray submit used to dismiss it — so saving from
// the keyboard needs its own key rather than the browser's implicit one.
describe("saving and leaving from the keyboard", () => {
  it("saves the editor with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      const put = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => String(c[1]?.method) === "PUT",
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1].body)).due).toBeTruthy();
    });
    // And it closes, as pressing Save does.
    expect(screen.queryByLabelText("Tags (comma separated)")).toBeNull();
  });

  it("leaves the editor with Escape, writing nothing", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Tags (comma separated)")).toBeNull();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[1]?.method) === "PUT",
      ),
    ).toHaveLength(0);
  });

  it("saves the defer panel with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    renderItem();

    await user.click(screen.getByLabelText("Defer"));
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c) => String(c[1]?.method) === "PUT",
        ),
      ).toHaveLength(1),
    );
  });

  // One press should undo one thing: closing a picker must not also close the
  // panel it sits in.
  it("keeps the panel open when Escape closes a picker", async () => {
    const user = userEvent.setup();
    setViewport("desktop");
    contexts = [{ id: 1, name: "@home", state: "active", position: 1 }];
    renderItem();

    await user.click(screen.getByLabelText("Edit this action"));
    await user.click(screen.getByLabelText("Context"));
    expect(screen.getByLabelText("Filter contexts")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Filter contexts")).toBeNull();
    expect(screen.getByLabelText("Tags (comma separated)")).toBeTruthy();
  });
});
