import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/components/PasswordSection", () => ({ PasswordSection: () => null }));
vi.mock("@/components/PasskeySection", () => ({ PasskeySection: () => null }));
vi.mock("@/components/TwoFactorSection", () => ({ TwoFactorSection: () => null }));
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
  it("shows account quota usage after the export pane", () => {
    render(<SettingsPage />);

    const exportTitle = screen.getByText("Export your data");
    const usageTitle = screen.getByText("Usage");
    expect(exportTitle.compareDocumentPosition(usageTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("3 of 10")).toBeTruthy();
  });
});
