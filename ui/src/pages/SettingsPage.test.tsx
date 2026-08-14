import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { email: "alice@example.com" }, ready: true, logout: vi.fn() }),
}));

const { requestEmailChange, updatePreferences } = vi.hoisted(() => ({
  requestEmailChange: vi.fn().mockResolvedValue(undefined),
  updatePreferences: vi.fn(),
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
      showFromDays: 0,
      autoDeleteAttachments: false,
      updatedAt: "2026-07-22T00:00:00Z",
    },
    isLoading: false,
  }),
  useUpdatePreferences: () => ({ mutate: updatePreferences, isPending: false }),
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
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const exportTitle = screen.getByText("Export your data");
    const usageTitle = screen.getByText("Usage");
    const deleteTitle = screen.getByText("Danger zone");
    expect(usageTitle.compareDocumentPosition(exportTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportTitle.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("3 of 10")).toBeTruthy();
  });

  it("puts irreversible account deletion last and confirms before emailing", async () => {
	const user = userEvent.setup();
	render(<MemoryRouter><SettingsPage /></MemoryRouter>);

	const usageTitle = screen.getByText("Usage");
	const deleteTitle = screen.getByText("Danger zone");
	expect(usageTitle.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

	await user.click(screen.getByRole("button", { name: "Delete my account" }));
	expect(screen.getByText("All of your data will be lost forever.")).toBeTruthy();
	expect(screen.getByText("Download your export before deleting your account if you want to keep a copy of your data and files.")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Email me a deletion link" })).toBeTruthy();
  });

  it("keeps the current email until a new address is verified", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    await user.type(screen.getByLabelText("New email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification email" }));

    expect(requestEmailChange).toHaveBeenCalledWith({ newEmail: "new@example.com" });
    expect(await screen.findByText("Check the new address for a verification link. Your current email is unchanged until you confirm it.")).toBeTruthy();
  });
});

// The setting that decides how far ahead of its due date a new action appears.
// It only reaches the server as a number of days, so the field has to send one.
describe("SettingsPage show-from default", () => {
  it("saves the lead time in days", async () => {
    const user = userEvent.setup();
    updatePreferences.mockClear();
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const field = screen.getByLabelText("Show actions this many days before they are due");
    await user.type(field, "3");

    // The second argument is the mutation's own callbacks, which this is not about.
    expect(updatePreferences.mock.calls[0][0]).toEqual({ showFromDays: 3 });
  });

  // The paragraph that used to sit under it explained the tickler in four
  // sentences, in a pane of one-line settings. The FAQ is where that belongs.
  it("explains itself in its label, with no paragraph under the field", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.queryByText(/waits in the tickler/)).toBeNull();
    expect(screen.getByLabelText("Show actions this many days before they are due")).toBeTruthy();
  });
});

describe("SettingsPage wording", () => {
  it("says which review period this is", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    // "Review period" alone reads as an account-wide setting; it is the
    // per-project one the project cards count against.
    expect(screen.getByLabelText("Project review period (days)")).toBeTruthy();
  });

  it("says only what auto-delete does not touch", () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText("Done actions are unaffected.")).toBeTruthy();
  });
});
