import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { LegalAdminPage } from "./LegalAdminPage";
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { email: "a@b.co" }, ready: true, logout: vi.fn() }) }));
import { useLegalEditor, useResetLegalDocument, useSaveLegalDocument } from "@/hooks/useLegal";

vi.mock("@/hooks/useLegal");

const editorState = {
  defaults: {
    en: { terms: "# Terms\n\nShipped terms.", privacy: "# Privacy\n\nShipped privacy.", cookies: "# Cookies\n\nShipped cookies." },
    fr: { terms: "# Conditions", privacy: "# Confidentialité", cookies: "# Cookies" },
  },
  overrides: { en: { privacy: "# Privacy\n\nHouse privacy." } },
};

beforeEach(() => {
  vi.mocked(useSaveLegalDocument).mockReturnValue({
    mutateAsync: vi.fn(), isPending: false,
  } as unknown as ReturnType<typeof useSaveLegalDocument>);
  vi.mocked(useResetLegalDocument).mockReturnValue({
    mutateAsync: vi.fn(), isPending: false,
  } as unknown as ReturnType<typeof useResetLegalDocument>);
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <I18nProvider>
          <LegalAdminPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("legal admin page", () => {
  // The boxes seed themselves from the loaded text exactly once. Mounting them
  // before it arrives leaves them empty for good, which is what happened.
  it("fills every box with the text in force", () => {
    vi.mocked(useLegalEditor).mockReturnValue({
      data: editorState,
    } as unknown as ReturnType<typeof useLegalEditor>);
    renderPage();

    const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.value.length).toBeGreaterThan(0);
    }
    // An edited document shows the draft, an untouched one the shipped text.
    // A document with a draft shows the draft; one without shows what readers
    // are being served, which is not necessarily the shipped text.
    expect(boxes.map((b) => b.value)).toEqual([
      "# Terms\n\nShipped terms.",
      "# Privacy\n\nHouse privacy.",
      "# Cookies\n\nShipped cookies.",
    ]);
  });

  it("waits rather than showing empty boxes while loading", () => {
    vi.mocked(useLegalEditor).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useLegalEditor>);
    renderPage();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
