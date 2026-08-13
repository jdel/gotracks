import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentsPage } from "./AttachmentsPage";
import { useAllAttachments } from "@/hooks/useSettings";
import { anAttachment } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { AttachmentWithTodo } from "@/lib/types";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useAllAttachments: vi.fn(),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAttachments: () => ({ mutate: vi.fn(), isPending: false }),
  usePreferences: () => ({ data: { timeZone: "UTC", dateFormat: "2006-01-02" } }),
}));

const rows: AttachmentWithTodo[] = [
  { ...anAttachment({ id: 1, todoId: 10, fileName: "z-plan.pdf", size: 900 }), todoDescription: "Plan renovation", todoState: "active" },
  {
    ...anAttachment({ id: 2, todoId: 11, fileName: "a-photo.jpg", contentType: "image/jpeg", size: 100 }),
    todoDescription: "Inspect wall",
    todoState: "completed",
  },
];

const renderPage = () => renderWithProviders(<AttachmentsPage />);

describe("AttachmentsPage mobile list", () => {
  beforeEach(() => {
    vi.mocked(useAllAttachments).mockReturnValue({ data: rows, isLoading: false } as ReturnType<typeof useAllAttachments>);
  });

  it("renders cards with context, metadata, and touch actions", () => {
    const { container } = renderPage();
    const list = container.querySelector("ul.md\\:hidden") as HTMLElement;

    expect(list).not.toBeNull();
    expect(within(list).getByText("Plan renovation")).toBeTruthy();
    expect(within(list).getByText("900 B")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Download z-plan.pdf" })).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Delete z-plan.pdf" })).toBeTruthy();
  });

  it("sorts the mobile cards without relying on the desktop table", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    const list = container.querySelector("ul.md\\:hidden") as HTMLElement;

    await user.selectOptions(screen.getByLabelText("Sort by"), "fileName");
    await user.click(screen.getByRole("button", { name: "Sort descending" }));

    const names = within(list).getAllByText(/\.(pdf|jpg)$/).map((node) => node.textContent);
    expect(names).toEqual(["a-photo.jpg", "z-plan.pdf"]);
  });
});
