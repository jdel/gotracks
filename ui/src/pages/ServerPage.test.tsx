import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { ServerPage } from "./ServerPage";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const requests: Array<{ method: string; url: string; body: unknown }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  requests.length = 0;
  localStorage.setItem("gt.access", "token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.includes("/admin/log-level")) {
        return json({ level: "info", baseline: "info", overrideUntil: null });
      }
      if (url.includes("/admin/settings")) {
        return json({ allowRegister: false, usageReportAtMinute: 0, usageReportTimeZone: "UTC", updatedAt: "" });
      }
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <I18nProvider>
          <ServerPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ServerPage", () => {
  it("shows the enrollment toggle and the log-level controls", async () => {
    renderPage();
    expect(await screen.findByText("Log level")).toBeDefined();
    expect(screen.getByLabelText("Allow public enrollment")).toBeDefined();
  });

  it("overrides the log level with a duration", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Log level");

    await user.selectOptions(screen.getByLabelText("Level"), "debug");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const put = requests.find((r) => r.method === "PUT" && r.url.includes("/admin/log-level"));
    expect(put).toBeDefined();
    expect(put?.body).toMatchObject({ level: "debug", durationMinutes: 15 });
  });
});
