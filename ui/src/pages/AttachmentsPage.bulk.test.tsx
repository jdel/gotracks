import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentsPage } from "./AttachmentsPage";
import { mockApi, reply } from "@/test/api";
import { renderWithProviders } from "@/test/render";
import { anAttachment } from "@/test/fixtures";
import type { AttachmentWithTodo } from "@/lib/types";

/**
 * Deleting the attachments of every completed action, against a server that
 * refuses one of them.
 *
 * Run on the real hooks and a fake server rather than on a mocked mutation:
 * what broke here was the interaction between a rejected request, the busy
 * flag and the cache, and a mocked mutation has none of those.
 */

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

let files: AttachmentWithTodo[];
let deletedIds: number[];
const failDelete = new Set<number>();

const done = (id: number, fileName: string): AttachmentWithTodo => ({
  ...anAttachment({ id, todoId: 10 + id, fileName, size: 100 }),
  todoDescription: `action ${id}`,
  todoState: "completed",
});

/** The fake server, with a delete that can be made to refuse a chosen file. */
function server() {
  return mockApi({
    "GET /attachments": () => files,
    "GET /preferences": {},
    "DELETE /attachments/:id": ({ params }) => {
      const id = Number(params.id);
      deletedIds.push(id);
      if (failDelete.has(id)) return reply(409, { error: "attachment is in use" });
      // The server really did delete it, which is why a partial failure has to
      // reconcile the list rather than leave it as it was.
      files = files.filter((f) => f.id !== id);
      return reply(204);
    },
  });
}

beforeEach(() => {
  files = [done(1, "one.pdf"), done(2, "two.pdf")];
  deletedIds = [];
  failDelete.clear();
  localStorage.setItem("gt.access", "test-token");
  server();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const renderPage = () => renderWithProviders(<AttachmentsPage />);

async function openBulkDialog(user: ReturnType<typeof userEvent.setup>) {
  // Both presentations are in the document (cards and table), hence the *All*
  // queries throughout.
  await screen.findAllByText("one.pdf");
  await user.click(screen.getByRole("button", { name: /Delete attachments from done actions/ }));
  return screen.findByText("Delete attachments from done actions?");
}

describe("deleting the attachments of done actions", () => {
  it("closes and empties the list when all of them go", async () => {
    const user = userEvent.setup();
    renderPage();
    await openBulkDialog(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText("Delete attachments from done actions?")).toBeNull(),
    );
    expect(deletedIds).toEqual([1, 2]);
    await waitFor(() => expect(screen.queryAllByText("one.pdf")).toEqual([]));
  });

  it("stays open with the server's reason when one refuses", async () => {
    failDelete.add(2);
    const user = userEvent.setup();
    renderPage();
    await openBulkDialog(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    // The server's wording, not a generic failure: it is the only part that
    // says why.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("in use"));
    expect(deletedIds).toEqual([1, 2]);

    // The list reconciled even though the batch failed — the one that really
    // was deleted is gone, the one that refused is still there. This is the
    // part that outlived the dialog: a list showing files the server no longer
    // has looks perfectly normal to whoever reads it next.
    await waitFor(() => expect(screen.queryAllByText("one.pdf")).toEqual([]));
    expect(screen.getAllByText("two.pdf").length).toBeGreaterThan(0);

    // Not stuck busy, and the button now means the remainder rather than the
    // whole batch.
    const retry = await screen.findByRole("button", { name: "Retry the 1 that failed" });
    expect(retry.hasAttribute("disabled")).toBe(false);

    failDelete.clear();
    await user.click(retry);

    await waitFor(() =>
      expect(screen.queryByText("Delete attachments from done actions?")).toBeNull(),
    );
    expect(deletedIds).toEqual([1, 2, 2]);
  });
});
