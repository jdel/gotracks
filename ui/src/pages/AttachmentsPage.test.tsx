import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentsPage } from "./AttachmentsPage";
import { useAllAttachments } from "@/hooks/useSettings";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useAllAttachments: vi.fn(),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  usePreferences: () => ({ data: { timeZone: "UTC", dateFormat: "2006-01-02" } }),
}));

const rows = [
  { id: 1, todoId: 10, fileName: "z-plan.pdf", contentType: "application/pdf", size: 900, createdAt: "2026-07-20T00:00:00Z", todoDescription: "Plan renovation", todoState: "active" },
  { id: 2, todoId: 11, fileName: "a-photo.jpg", contentType: "image/jpeg", size: 100, createdAt: "2026-07-21T00:00:00Z", todoDescription: "Inspect wall", todoState: "completed" },
];

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AttachmentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
