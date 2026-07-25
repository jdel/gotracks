import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";

const { requestEmailChange } = vi.hoisted(() => ({
  requestEmailChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/PasswordSection", () => ({ PasswordSection: () => null }));
vi.mock("@/components/PasskeySection", () => ({ PasskeySection: () => null }));
vi.mock("@/components/TwoFactorSection", () => ({ TwoFactorSection: () => null }));
vi.mock("@/components/SessionSection", () => ({ SessionSection: () => null }));
vi.mock("@/hooks/useSettings", () => ({
  downloadExport: vi.fn(),
  usePreferences: () => ({
    data: {
      userId: 1,
      dateFormat: "2006-01-02",
      timeZone: "UTC",
      locale: "en",
      theme: "system",
      weekStart: 1,
      reviewPeriod: 7,
      autoDeleteAttachments: false,
      updatedAt: "2026-07-22T00:00:00Z",
    },
    isLoading: false,
  }),
  useUpdatePreferences: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestAccountDeletion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestEmailChange: () => ({ mutateAsync: requestEmailChange, isPending: false }),
  useMyUsage: () => ({
    data: {
      storageBytes: 1024,
      storageLimit: 2048,
      todos: 3,
      todoLimit: 10,
      projects: 1,
      projectLimit: 5,
      notes: 0,
      noteLimit: 5,
      contexts: 2,
      contextLimit: 5,
      tags: 2,
      tagLimit: 10,
      recurring: 1,
      recurringLimit: 5,
    },
    isLoading: false,
    error: null,
  }),
}));

describe("SettingsPage usage pane", () => {
  it("puts export immediately before account deletion", () => {
    render(<SettingsPage />);

    const exportTitle = screen.getByText("Export your data");
    const usageTitle = screen.getByText("Usage");
    const deleteTitle = screen.getByText("Delete your account");
    expect(usageTitle.compareDocumentPosition(exportTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportTitle.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("3 of 10")).toBeTruthy();
  });

  it("puts irreversible account deletion last and confirms before emailing", async () => {
	const user = userEvent.setup();
	render(<SettingsPage />);

	const usageTitle = screen.getByText("Usage");
	const deleteTitle = screen.getByText("Delete your account");
	expect(usageTitle.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

	await user.click(screen.getByRole("button", { name: "Delete my account" }));
	expect(screen.getByText("All of your data will be lost forever.")).toBeTruthy();
	expect(screen.getByText("Download your export before deleting your account if you want to keep a copy of your data and files.")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Email me a deletion link" })).toBeTruthy();
  });

  it("keeps the current email until a new address is verified", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByLabelText("New email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification email" }));

    expect(requestEmailChange).toHaveBeenCalledWith({ newEmail: "new@example.com" });
    expect(await screen.findByText("Check the new address for a verification link. Your current email is unchanged until you confirm it.")).toBeTruthy();
  });
});
