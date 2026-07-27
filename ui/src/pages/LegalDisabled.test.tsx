import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { TermsPage, LegalLinks } from "@/pages/LegalPage";
import { RequireLegal } from "@/components/RequireLegal";
import { useServerConfig } from "@/hooks/useSettings";

vi.mock("@/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useSettings")>()),
  useServerConfig: vi.fn(),
}));

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      // The routes are not registered when the pages are off.
      return new Response("not found", { status: 404 });
    }),
  );
  vi.mocked(useServerConfig).mockReturnValue({
    data: { allowRegister: true, passkeys: false, twoFactor: false, legal: false },
    isPending: false,
  } as unknown as ReturnType<typeof useServerConfig>);
});

function renderWith(children: React.ReactNode, route = "/") {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <I18nProvider>{children}</I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// With the pages off there is nothing to show, nothing to accept, and — the
// part that is easy to get wrong — nothing to ask the server about.
describe("legal disabled", () => {
  it("shows no footer links", () => {
    renderWith(<LegalLinks />);
    expect(screen.queryByText("Terms")).toBeNull();
    expect(screen.queryByText("Privacy")).toBeNull();
  });

  it("sends the document routes away rather than rendering an empty page", async () => {
    renderWith(
      <Routes>
        <Route path="/terms" element={<RequireLegal><TermsPage /></RequireLegal>} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>,
      "/terms",
    );
    expect(await screen.findByText("Home")).toBeDefined();
    await waitFor(() =>
      expect(requested.filter((u) => u.includes("/legal"))).toHaveLength(0),
    );
  });
});
