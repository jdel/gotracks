import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./Layout";
import { I18nProvider } from "@/lib/I18nProvider";
import { useAuth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
// The shell reads the instance's capabilities to decide whether to offer the
// Legal section and which build to print. Legal stays off here so the section
// list below is exactly the one every deployment shows.
vi.mock("@/hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useSettings")>()),
  useServerConfig: () => ({
    data: {
      allowRegister: true,
     
      passkeys: false,
      twoFactor: false,
      legal: false,
    },
  }),
  useServerVersion: () => ({ data: { version: "v9.9.9" } }),
}));

// Every section the app routes to. If a route is added without a nav entry,
// the reachability test below fails rather than the link quietly going missing
// on phones, which is how /admin became unreachable there.
const SECTIONS = [
  "Actions",
  "Projects",
  "Tickler",
  "Tags",
  "Contexts",
  "Recurring",
  "Starred",
  "Done",
  "Statistics",
  "Settings",
];

function renderLayout({ isAdmin = false } = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, login: "alice", email: "", isAdmin, createdAt: "", updatedAt: "" },
    ready: true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <I18nProvider>
          <Layout />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Link labels in the mobile top bar (stats, settings, admin). */
function topBarLinks(): string[] {
  const header = document.querySelector("header") as HTMLElement | null;
  if (!header) return [];
  return Array.from(header.querySelectorAll("a")).map(
    (a) => (a.getAttribute("aria-label") ?? a.textContent ?? "").trim(),
  );
}

/** Link labels in the bottom tab bar. */
function tabBarLinks(): string[] {
  const bar = document.querySelector("nav.fixed") as HTMLElement | null;
  if (!bar) return [];
  return Array.from(bar.querySelectorAll("a")).map((a) => (a.textContent ?? "").trim());
}

/** Link labels in the open "More" sheet. */
function sheetLinks(): string[] {
  const sheet = document.querySelector('[role="dialog"]') as HTMLElement | null;
  if (!sheet) return [];
  return Array.from(sheet.querySelectorAll("a")).map((a) => (a.textContent ?? "").trim());
}

/**
 * Everything reachable without typing a URL. The tab bar is read before the
 * sheet opens: the sheet traps focus and marks the rest of the page hidden, so
 * querying both at once would miss the tabs.
 */
async function allMobileLinks(): Promise<string[]> {
  const reachable = [...tabBarLinks(), ...topBarLinks()];
  await userEvent.click(screen.getByRole("button", { name: /More/i }));
  return [...reachable, ...sheetLinks()];
}

describe("mobile navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reaches every section through the tab bar or the More sheet", async () => {
    renderLayout();

    const reachable = await allMobileLinks();
    for (const section of SECTIONS) {
      expect(reachable, `"${section}" is unreachable on mobile`).toContain(section);
    }
  });

  it("offers Admin to an admin, from the top bar", async () => {
    renderLayout({ isAdmin: true });

    expect(topBarLinks()).toContain("Admin");
    expect(await allMobileLinks()).toContain("Admin");
  });

  // Settings stays one tap from anywhere; Statistics lives in the sheet.
  it("keeps Settings in the top bar and Statistics in the sheet", async () => {
    renderLayout();

    expect(topBarLinks()).toContain("Settings");
    expect(topBarLinks()).not.toContain("Statistics");

    await userEvent.click(screen.getByRole("button", { name: /More/i }));
    expect(sheetLinks()).toContain("Statistics");
  });

  it("does not offer Admin to a non-admin", async () => {
    renderLayout({ isAdmin: false });

    expect(topBarLinks()).not.toContain("Admin");
    expect(await allMobileLinks()).not.toContain("Admin");
  });

  it("keeps the tab bar small enough for thumbs", () => {
    renderLayout({ isAdmin: true });

    // Four tabs plus the More button: more than five targets across a phone
    // is the crowding this replaced.
    const bar = document.querySelector("nav.fixed") as HTMLElement;
    expect(tabBarLinks()).toHaveLength(4);
    expect(bar.querySelectorAll("button")).toHaveLength(1);
  });

  // The top-bar entries are links rendered through IconButton's asChild path,
  // so the tooltip trigger has to survive being composed onto a NavLink.
  it("still shows a tooltip for the top-bar links", async () => {
    renderLayout();

    const settings = document.querySelector('header a[aria-label="Settings"]') as HTMLElement;
    expect(settings).not.toBeNull();
    // Keyboard focus opens a radix tooltip without waiting out the hover delay.
    settings.focus();
    await waitFor(() => {
      expect(screen.getAllByText("Settings").length).toBeGreaterThan(1);
    });
  });

  it("closes the sheet after navigating", async () => {
    renderLayout();

    await userEvent.click(screen.getByRole("button", { name: /More/i }));
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(sheet).getByRole("link", { name: /Starred/i }));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

// The sidebar used to be a plain flex child of a row, so it stretched to the
// height of whatever was beside it and mt-auto pushed sign-out to the bottom of
// that column. On a long page (Settings) it landed below the fold. Pinning it to
// the viewport is what keeps the account block on screen.
describe("desktop sidebar", () => {
  it("is pinned to the viewport rather than stretched by the page", () => {
    renderLayout();
    const aside = document.querySelector("aside");
    expect(aside).not.toBeNull();
    const className = aside!.className;
    for (const token of ["md:sticky", "md:top-0", "md:h-dvh"]) {
      expect(className, `sidebar is missing ${token}`).toContain(token);
    }
  });

  // If the sections ever outgrow the viewport the nav has to scroll on its own,
  // or it pushes the account block out again.
  it("lets the section list scroll without displacing the account block", () => {
    renderLayout();
    const nav = document.querySelector("aside nav");
    expect(nav?.className).toContain("overflow-y-auto");
  });
});

// The version is the last line of the sidebar, under the legal links, so a bug
// report can name the build it came from.
describe("build version", () => {
  it("is shown at the very bottom of the sidebar", async () => {
    renderLayout();
    const version = await screen.findByText(/gotracks v9\.9\.9/);
    const footer = document.querySelector("aside > div:last-child");
    expect(footer?.contains(version)).toBe(true);
    // Last child of the block: below the sign-out button and the legal links.
    expect(footer?.lastElementChild).toBe(version);
  });
});
