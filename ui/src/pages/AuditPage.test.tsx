import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/I18nProvider";
import { AuditPage } from "./AuditPage";
import { useAuditActions, useAuditLog } from "@/hooks/useAudit";
import type { AuditEvent } from "@/lib/types";

vi.mock("@/hooks/useAudit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useAudit")>()),
  useAuditLog: vi.fn(),
  useAuditActions: vi.fn(),
}));

const events: AuditEvent[] = [
  {
    id: 2,
    occurredAt: "2026-07-24T10:00:00Z",
    action: "admin.user.deleted",
    outcome: "success",
    actorEmail: "admin@example.com",
    targetEmail: "bob@example.com",
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0 (Probe)",
    detail: "",
  },
  {
    id: 1,
    occurredAt: "2026-07-24T09:00:00Z",
    action: "account.login.failed",
    outcome: "failure",
    targetEmail: "alice@example.com",
    ip: "203.0.113.4",
    detail: "invalid credentials",
  },
  {
    id: 3,
    occurredAt: "2026-07-24T08:00:00Z",
    action: "admin.audit.exported",
    outcome: "success",
    actorEmail: "admin@example.com",
    detail: "csv, 2 entries: no filter",
    hash: "9f2a1c" + "0".repeat(58),
  },
];

beforeEach(() => {
  vi.mocked(useAuditActions).mockReturnValue({
    data: ["admin.user.deleted", "account.login.failed"],
  } as unknown as ReturnType<typeof useAuditActions>);
  vi.mocked(useAuditLog).mockReturnValue({
    data: { items: events, total: 3 },
    isPending: false,
  } as unknown as ReturnType<typeof useAuditLog>);
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <I18nProvider>
          <AuditPage />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("audit page", () => {
  // Four columns, so the table reads without scrolling sideways. Everything
  // else belongs behind the details button.
  it("shows a compact row per entry", () => {
    renderPage();
    // Scoped to the table: the filter dropdown offers the same vocabulary.
    const table = within(screen.getByRole("table"));
    expect(screen.getAllByRole("columnheader")).toHaveLength(5); // four labelled, one for the button
    expect(table.getByText("admin.user.deleted")).toBeDefined();
    // Anything that only belongs in the details must not widen the table.
    expect(table.queryByText("Mozilla/5.0 (Probe)")).toBeNull();
  });

  // An administrator acting on somebody else is two people; showing only the
  // one who clicked loses the half that matters.
  it("names both sides of an administrator action", () => {
    renderPage();
    expect(screen.getByText("admin@example.com → bob@example.com")).toBeDefined();
    // A self-service or anonymous event names one person, without an arrow.
    expect(screen.getByText("alice@example.com")).toBeDefined();
  });

  it("puts the address, browser and note behind the details button", async () => {
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]);
    expect(await screen.findByText("203.0.113.9")).toBeDefined();
    expect(screen.getByText("Mozilla/5.0 (Probe)")).toBeDefined();
  });

  // Only an export carries a fingerprint. It ties the entry to the exact file
  // that left the service, shown behind a paperclip in the details.
  it("shows the export fingerprint behind the details, not in the table", async () => {
    renderPage();
    expect(within(screen.getByRole("table")).queryByText(/9f2a1c/)).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "Show details" })[2]);
    expect(await screen.findByText(/sha256:9f2a1c/)).toBeDefined();
    expect(screen.getByText("Fingerprint")).toBeDefined();
  });

  it("offers no fingerprint on a non-export entry", async () => {
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Show details" })[1]);
    expect(screen.queryByText("Fingerprint")).toBeNull();
  });

  it("marks a failure so it stands out from routine traffic", () => {
    renderPage();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Failure").className).toContain("destructive");
    for (const ok of table.getAllByText("Success")) {
      expect(ok.className).not.toContain("destructive");
    }
  });
});

// Every search is recorded, so the filter must not fire per keystroke: the
// inputs edit a draft and Apply is the one deliberate act that queries.
describe("audit filter", () => {
  it("does not search while the filter is being typed", async () => {
    let lastQueryFilter: unknown;
    vi.mocked(useAuditLog).mockImplementation((filter) => {
      lastQueryFilter = filter;
      return {
        data: { items: events, total: 3 },
        isPending: false,
      } as unknown as ReturnType<typeof useAuditLog>;
    });
    renderPage();

    await userEvent.type(screen.getByPlaceholderText("Email address"), "victim@example.com");
    // Typing changed no applied filter, so the query is still the empty one.
    expect(lastQueryFilter).toEqual({});

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(lastQueryFilter).toMatchObject({ actor: "victim@example.com" });
  });
})
