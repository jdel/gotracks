import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  AtSign,
  BarChart3,
  CalendarClock,
  ClipboardList,
  FolderKanban,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Repeat,
  Scale,
  ScrollText,
  Server,
  Settings,
  StickyNote,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useServerConfig, useServerVersion } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { Dialog, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Mark } from "@/components/primitives";
import { formatVersion } from "@/lib/version";
import { cn } from "@/lib/utils";
import { LegalLinks } from "@/pages/LegalPage";

// nav is the single list of sections. The desktop sidebar shows all of it; on
// mobile the first four are tabs and the rest live behind "More", so a section
// added here can never end up unreachable on a phone.
type NavItem = {
  to: string;
  labelKey: Parameters<ReturnType<typeof useT>>[0];
  /** Shown in the desktop sidebar, and all that is left of an item once it
   *  collapses. The mobile nav stays text-only. */
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  /** Hidden unless the instance serves the legal pages at all. */
  legalOnly?: boolean;
};

// Order matters: the first four non-admin sections are the mobile tab bar
// (Actions, Projects, Tickler, Notes), so Notes sits ahead of Tags here.
const nav: NavItem[] = [
  { to: "/", labelKey: "nav.actions", icon: ListChecks, end: true },
  { to: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { to: "/tickler", labelKey: "nav.tickler", icon: CalendarClock },
  { to: "/notes", labelKey: "nav.notes", icon: StickyNote },
  { to: "/tags", labelKey: "nav.tags", icon: Tag },
  { to: "/contexts", labelKey: "nav.contexts", icon: AtSign },
  { to: "/recurring", labelKey: "nav.recurring", icon: Repeat },
  { to: "/stats", labelKey: "nav.stats", icon: BarChart3 },
  { to: "/attachments", labelKey: "nav.attachments", icon: Paperclip },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
  { to: "/admin/settings", labelKey: "nav.server", icon: Server, adminOnly: true },
  { to: "/admin", labelKey: "nav.users", icon: Users, adminOnly: true, end: true },
  { to: "/reports", labelKey: "nav.reports", icon: ClipboardList, adminOnly: true },
  { to: "/legal", labelKey: "nav.legal", icon: Scale, adminOnly: true, legalOnly: true },
  { to: "/audit", labelKey: "nav.audit", icon: ScrollText, adminOnly: true },
];

// On mobile the list is dealt out two ways: the first four as tabs along the
// bottom, everything else behind "More". Derived from the one array, so a new
// section always lands somewhere.
const MOBILE_TABS = 4;
const primaryNav = nav.slice(0, MOBILE_TABS);
const overflowNav = nav.slice(MOBILE_TABS);

const sidebarItem =
  "rounded-[10px] px-3 py-2 text-sm transition-colors";
const sidebarActive =
  "bg-brand-soft font-extrabold text-brand dark:bg-brand-pill-dark dark:text-brand-ink-dark";
const sidebarInactive =
  "font-medium text-ink-2 hover:bg-surface dark:text-ink-2-dark dark:hover:bg-card-dark";

// Whether the sidebar is collapsed to icons. Per-device, like the other local
// conveniences — it is a viewing preference, not account data.
const COLLAPSED_KEY = "gt.sidebarCollapsed";

export function Layout() {
  const { user, logout } = useAuth();
  const { data: serverConfig } = useServerConfig();
  const { data: build } = useServerVersion();
  const t = useT();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );

  function toggleCollapsed() {
    setCollapsed((was) => {
      localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      return !was;
    });
  }

  const canSee = (item: NavItem) =>
    (!item.adminOnly || user?.isAdmin === true) &&
    (!item.legalOnly || serverConfig?.legal === true);
  const userNav = nav.filter((i) => !i.adminOnly && canSee(i));
  const adminNav = nav.filter((i) => i.adminOnly && canSee(i));
  const visibleOverflow = overflowNav.filter(canSee);
  // Whether the open page lives behind "More", so that tab can show as active.
  const inOverflow = visibleOverflow.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );

  // The mobile "More" sheet stays text-only, exactly as it was.
  const link = (item: NavItem, onClick?: () => void) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(sidebarItem, isActive ? sidebarActive : sidebarInactive)
      }
    >
      {t(item.labelKey)}
    </NavLink>
  );

  // The desktop sidebar row: icon + label, or just the icon once collapsed —
  // where the label becomes the accessible name and the hover tooltip instead.
  const sidebarLink = (item: NavItem) => {
    const label = t(item.labelKey);
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          cn(
            sidebarItem,
            // A fixed row height in both states. Without it the row shrinks to
            // the icon when the label goes, and every row below creeps upwards.
            // The padding is kept when collapsed too — centring the icon in the
            // narrower column would shift it sideways, so the icon simply stays
            // where it was and the label goes.
            "flex min-h-10 items-center gap-2.5",
            isActive ? sidebarActive : sidebarInactive,
          )
        }
      >
        <Icon className="size-4 flex-none" aria-hidden />
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    );
  };

  return (
    <div className="min-h-dvh bg-surface md:flex dark:bg-surface-dark">
      {/* Desktop sidebar. Pinned to the viewport so the account block stays on
          screen on long pages; the nav scrolls on its own if it ever overflows. */}
      <aside
        className={cn(
          // relative: the collapse handle is positioned against this box so it
          // can straddle the right border.
          // md:z-20: `position: sticky` makes this a stacking context, so the
          // handle's own z-index cannot lift it above the content column that
          // follows in the DOM — the whole sidebar has to outrank it, or the
          // overhanging half of the handle is covered and swallows the click.
          "relative hidden flex-none flex-col border-r border-line bg-card px-3 py-[18px] md:sticky md:top-0 md:z-20 md:flex md:h-dvh dark:border-line-dark dark:bg-card-dark",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        {/* The handle straddles the right border — centred on the line itself,
            so it reads as belonging to the edge rather than to the header, and
            it lands in the same place whatever the sidebar's width. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
          title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
          className={cn(
            // top-[18px] keeps it centred on the header row: py-[18px] + half of h-8.
            "absolute top-[18px] right-0 z-10 flex size-8 translate-x-1/2 items-center justify-center",
            "rounded-full border border-line bg-card text-ink-3 shadow-card transition-colors",
            "hover:bg-surface hover:text-ink dark:border-line-dark dark:bg-card-dark dark:text-ink-2-dark dark:shadow-none dark:hover:bg-surface-dark dark:hover:text-ink-dark",
            // An invisible 44px target around the 32px circle: the visible handle
            // stays light on the border, the thing you have to hit does not.
            "before:absolute before:-inset-1.5 before:content-['']",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" />
          ) : (
            <PanelLeftClose className="size-[18px]" />
          )}
        </button>

        {/* mb, not pb: border-box would fold the padding into the fixed height.
            Left-aligned in both states for the same reason as the nav rows: the
            mark must not slide sideways when the column narrows. */}
        <div className="mb-4 flex h-8 items-center gap-2.5">
          <Mark size={26} dot />
          {!collapsed && (
            <span className="text-lg font-extrabold tracking-[-0.045em] text-ink dark:text-ink-dark">
              gotracks
            </span>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {userNav.map((i) => sidebarLink(i))}
          {adminNav.length > 0 && (
            <div className="mt-3 flex flex-col gap-0.5 border-t border-line-3 pt-3 dark:border-line-dark">
              {adminNav.map((i) => sidebarLink(i))}
            </div>
          )}
        </nav>
        {/* Collapsed, the account block is one sign-out icon: the e-mail, legal
            links and version have nowhere to go in 68px. */}
        {collapsed ? (
          <div className="mt-auto flex flex-col border-t border-line-3 pt-3.5 dark:border-line-dark">
            {/* Same padding and height as a nav row, so its icon lands on the
                same vertical line as the ones above it. */}
            <button
              type="button"
              onClick={logout}
              aria-label={t("nav.signOut")}
              title={t("nav.signOut")}
              className="flex min-h-10 items-center rounded-[10px] px-3 text-brand transition-colors hover:bg-surface dark:text-brand-ink-dark dark:hover:bg-card-dark"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-2 border-t border-line-3 px-3 pt-3.5 dark:border-line-dark">
            <span className="truncate text-xs font-medium text-ink-2 dark:text-ink-2-dark">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={logout}
              className="w-fit text-left text-xs font-medium text-brand underline underline-offset-2 hover:opacity-80 dark:text-brand-ink-dark"
            >
              {t("nav.signOut")}
            </button>
            <LegalLinks className="text-[11px] font-medium text-ink-4" />
            {build?.version && (
              <span className="mono text-[10px] text-ink-4">{formatVersion(build.version)}</span>
            )}
          </div>
        )}
      </aside>

      {/* Content column. The page (via Screen) renders its own header + main;
          the tab bar sticks to the bottom on mobile. */}
      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip md:min-h-0">
        <Outlet />

        {/* Mobile bottom tab bar — text-only labels, active on a brand-soft pill. */}
        <nav className="sticky bottom-0 z-30 flex h-[62px] items-center justify-around border-t border-line bg-card px-1.5 md:hidden dark:border-line-dark dark:bg-nav-dark">
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex h-full min-w-[44px] items-center justify-center px-2 text-[11px]",
                  isActive
                    ? "font-extrabold text-brand dark:text-brand-ink-dark"
                    : "font-semibold text-ink-4 dark:text-ink-4-dark",
                )
              }
            >
              {({ isActive }) => (
                <span
                  className={cn(
                    "max-w-full truncate",
                    isActive && "rounded-full bg-brand-soft px-2.5 py-1.5 dark:bg-brand-pill-dark",
                  )}
                >
                  {t(item.labelKey)}
                </span>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className={cn(
              "flex h-full min-w-[44px] items-center justify-center px-2 text-[11px]",
              inOverflow
                ? "font-extrabold text-brand dark:text-brand-ink-dark"
                : "font-semibold text-ink-4 dark:text-ink-4-dark",
            )}
          >
            <span
              className={cn(
                inOverflow && "rounded-full bg-brand-soft px-2.5 py-1.5 dark:bg-brand-pill-dark",
              )}
            >
              {t("nav.more")}
            </span>
          </button>
        </nav>
      </div>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="md:hidden">
          <DialogTitle className="sr-only">{t("nav.more")}</DialogTitle>
          <nav className="grid grid-cols-2 gap-1">
            {visibleOverflow.map((item) => link(item, () => setMenuOpen(false)))}
          </nav>
          <div className="mt-3 border-t border-line-3 pt-3 dark:border-line-dark">
            <p className="truncate px-3 text-sm text-ink-4">{user?.email}</p>
            {/* The desktop sidebar carries these; hidden here, a signed-in phone
                would otherwise have no route to sign out or to the legal pages. */}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
              className="mt-1 w-fit px-3 text-left text-xs font-medium text-brand underline underline-offset-2 dark:text-brand-ink-dark"
            >
              {t("nav.signOut")}
            </button>
            <LegalLinks
              className="px-3 pt-2 text-[11px] font-medium text-ink-4"
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </SheetContent>
      </Dialog>
    </div>
  );
}
