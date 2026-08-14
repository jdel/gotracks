import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  "Statistics",
  "Settings",
];

function renderLayout({ isAdmin = false } = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, login: "alice", email: "alice@example.com", isAdmin, createdAt: "", updatedAt: "" },
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

/** Link labels in the bottom tab bar. */
function tabBarLinks(): string[] {
  const bar = document.querySelector("nav.sticky") as HTMLElement | null;
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
  const reachable = [...tabBarLinks()];
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

  it("offers Admin to an admin, from the More sheet", async () => {
    renderLayout({ isAdmin: true });

    expect(await allMobileLinks()).toContain("Users");
  });

  // Settings and Statistics both live in the sheet now that the top bar is gone.
  it("keeps Settings and Statistics in the sheet", async () => {
    renderLayout();

    expect(tabBarLinks()).not.toContain("Settings");

    await userEvent.click(screen.getByRole("button", { name: /More/i }));
    expect(sheetLinks()).toContain("Settings");
    expect(sheetLinks()).toContain("Statistics");
  });

  it("keeps account identity and sign out out of the More sheet", async () => {
    renderLayout();

    await userEvent.click(screen.getByRole("button", { name: /More/i }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByText("alice@example.com")).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("does not offer Admin to a non-admin", async () => {
    renderLayout({ isAdmin: false });

    expect(await allMobileLinks()).not.toContain("Users");
  });

  it("keeps the tab bar small enough for thumbs", () => {
    renderLayout({ isAdmin: true });

    // Four tabs plus the More button: more than five targets across a phone
    // is the crowding this replaced.
    const bar = document.querySelector("nav.sticky") as HTMLElement;
    expect(tabBarLinks()).toHaveLength(4);
    expect(bar.querySelectorAll("button")).toHaveLength(1);
  });

  it("closes the sheet after navigating", async () => {
    renderLayout();

    await userEvent.click(screen.getByRole("button", { name: /More/i }));
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(sheet).getByRole("link", { name: /Recurring/i }));

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
    const version = await screen.findByText("v9.9.9");
    const footer = document.querySelector("aside > div:last-child");
    expect(footer?.contains(version)).toBe(true);
    // Last child of the block: below the sign-out button and the legal links.
    expect(footer?.lastElementChild).toBe(version);
  });
});

// The desktop sidebar collapses to icons. Mobile is untouched by this — the tab
// bar and the "More" sheet stay text-only.
describe("collapsing the sidebar", () => {
  const sidebar = () => document.querySelector("aside") as HTMLElement;

  // The choice is remembered in localStorage, so each test starts expanded.
  beforeEach(() => localStorage.clear());

  it("shows an icon next to every section label", () => {
    renderLayout();
    const links = Array.from(sidebar().querySelectorAll("nav a"));
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.querySelector("svg")).not.toBeNull();
      expect((a.textContent ?? "").trim()).not.toBe("");
    }
  });

  it("drops the labels and the account block when collapsed", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    const links = Array.from(sidebar().querySelectorAll("nav a"));
    for (const a of links) {
      expect(a.querySelector("svg")).not.toBeNull();
      expect((a.textContent ?? "").trim()).toBe("");
    }
    // Only the sign-out icon is left at the bottom: no e-mail, legal links or version.
    expect(sidebar().querySelector("aside > div:last-child a")).toBeNull();
    expect(screen.queryByText("v9.9.9")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  // Both were real complaints: the toggle jumped to a second line, and every
  // nav row lost height when its label went, creeping the icons upwards.
  it("keeps the toggle and the row geometry fixed across the toggle", async () => {
    const user = userEvent.setup();
    renderLayout();

    const toggle = () => screen.getByRole("button", { name: /(Collapse|Expand) menu/ });
    const rows = () => Array.from(sidebar().querySelectorAll("nav a"));

    // The handle is positioned against the sidebar and centred on its right
    // border, so it does not belong to the header row and cannot be moved by
    // the wordmark coming and going.
    const before = toggle().className;
    for (const token of ["absolute", "right-0", "translate-x-1/2", "top-[18px]"]) {
      expect(before, `handle is missing ${token}`).toContain(token);
    }
    // A 32px circle with a 44px hit area around it.
    expect(before).toContain("size-8");
    expect(before).toContain("before:-inset-1.5");
    expect(toggle().parentElement).toBe(sidebar());
    // The sticky sidebar is its own stacking context, so it — not the handle —
    // has to outrank the content column, or the overhanging half of the handle
    // is painted over and stops taking clicks.
    expect(sidebar().className).toContain("md:z-20");

    await user.click(toggle());

    expect(toggle().className).toBe(before);
    expect(toggle().parentElement).toBe(sidebar());
    // Every row keeps its height, so nothing shifts vertically.
    for (const a of rows()) expect(a.className).toContain("min-h-10");
  });

  // Collapsing must not slide anything sideways: centring the icons in the
  // narrower column moved them right, and the mark further than the icons.
  it("leaves the icons and the mark on the same vertical line", async () => {
    const user = userEvent.setup();
    renderLayout();

    const header = () => sidebar().querySelector("div") as HTMLElement;
    const rows = () => Array.from(sidebar().querySelectorAll("nav a"));
    const before = { header: header().className, rows: rows().map((a) => a.className) };
    expect(before.header).not.toContain("justify-center");
    for (const c of before.rows) expect(c).toContain("px-3");

    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    expect(header().className).toBe(before.header);
    for (const c of rows().map((a) => a.className)) {
      expect(c).toContain("px-3");
      expect(c).not.toContain("justify-center");
    }
    // The sidebar's own padding is the other half of the icon's offset.
    expect(sidebar().className).toContain("px-3");
  });

  it("keeps the mark visible when collapsed", async () => {
    const user = userEvent.setup();
    renderLayout();

    const mark = () => sidebar().querySelector('[aria-hidden="true"]');
    expect(mark()).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    expect(mark()).not.toBeNull();
    // The wordmark is what goes, not the mark.
    expect(sidebar().textContent).not.toContain("gotracks");
  });

  it("keeps the mobile navigation text-only either way", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    expect(tabBarLinks()).toEqual(["Actions", "Tickler", "Contexts", "Projects"]);
    const bar = document.querySelector("nav.sticky") as HTMLElement;
    expect(bar.querySelector("a svg")).toBeNull();
  });

  it("remembers the choice for next time", async () => {
    const user = userEvent.setup();
    const first = renderLayout();
    await user.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(localStorage.getItem("gt.sidebarCollapsed")).toBe("1");
    first.unmount();

    renderLayout();
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeTruthy();
  });
});

// The tab bar is the first four entries of the one nav list, so its contents
// are a property of that list's order — worth pinning, since reordering the
// list for the sidebar would silently change what a phone shows.
describe("the mobile tab bar", () => {
  it("carries Actions, Tickler, Contexts and Projects, then More", async () => {
    renderLayout();

    expect(tabBarLinks()).toEqual(["Actions", "Tickler", "Contexts", "Projects"]);
    expect(screen.getByRole("button", { name: /More/i })).toBeTruthy();
    // The four it displaced are still reachable, just behind More.
    expect(await allMobileLinks()).toContain("Notes");
  });
});

// The navigation menu was the last drawer built on a different primitive: it
// had a grab handle that did nothing, no scroll lock and no inert background.
// It shares the one Sheet now, so it has to behave like every other drawer.
describe("the More menu is an ordinary drawer", () => {
  it("locks the page behind it and pulls down to dismiss", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: /More/i }));
    const sheet = screen.getByRole("dialog");
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);

    const grip = sheet.querySelector("[data-sheet-grip]")!;
    fireEvent.pointerDown(grip, { pointerType: "touch", clientY: 100 });
    fireEvent.pointerMove(grip, { pointerType: "touch", clientY: 400 });
    fireEvent.pointerUp(grip, { pointerType: "touch", clientY: 400 });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.hasAttribute("data-scroll-locked")).toBe(false));
  });
});
