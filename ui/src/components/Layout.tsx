import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Inbox,
  ListChecks,
  FolderOpen,
  CalendarClock,
  Star,
  CheckCheck,
  Tags,
  Repeat,
  BarChart3,
  Settings,
  Users,
  BarChart4,
  Paperclip,
  StickyNote,
  LogOut,
  MoreHorizontal,
  Scale,
  ScrollText,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useServerConfig, useServerVersion } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { BrandIcon } from "@/components/BrandIcon";
import { cn } from "@/lib/utils";
import { LegalLinks } from "@/pages/LegalPage";

// nav is the single list of sections. The desktop sidebar shows all of it; on
// mobile the first few are tabs and the rest live behind "More", so a section
// added here can never end up unreachable on a phone.
type NavItem = {
  to: string;
  labelKey: Parameters<ReturnType<typeof useT>>[0];
  icon: typeof Inbox;
  end?: boolean;
  adminOnly?: boolean;
  /** Hidden unless the instance serves the legal pages at all. */
  legalOnly?: boolean;
  /** Sits in the mobile top bar beside sign-out rather than in the tab bar. */
  topBar?: boolean;
};

const nav: NavItem[] = [
  { to: "/", labelKey: "nav.actions", icon: Inbox, end: true },
  { to: "/projects", labelKey: "nav.projects", icon: FolderOpen },
  { to: "/tickler", labelKey: "nav.tickler", icon: CalendarClock },
  { to: "/tags", labelKey: "nav.tags", icon: Tags },
  { to: "/notes", labelKey: "nav.notes", icon: StickyNote },
  { to: "/contexts", labelKey: "nav.contexts", icon: ListChecks },
  { to: "/recurring", labelKey: "nav.recurring", icon: Repeat },
  { to: "/starred", labelKey: "nav.starred", icon: Star },
  { to: "/done", labelKey: "nav.done", icon: CheckCheck },
  { to: "/stats", labelKey: "nav.stats", icon: BarChart3 },
  { to: "/attachments", labelKey: "nav.attachments", icon: Paperclip },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, topBar: true },
  { to: "/legal", labelKey: "nav.legal", icon: Scale, adminOnly: true, legalOnly: true },
  { to: "/reports", labelKey: "nav.reports", icon: BarChart4, adminOnly: true },
  { to: "/audit", labelKey: "nav.audit", icon: ScrollText, adminOnly: true },
  { to: "/admin", labelKey: "nav.admin", icon: Users, adminOnly: true, topBar: true },
];

// On mobile the list is dealt out three ways: a few tabs along the bottom, the
// utility sections as icons in the top bar, and everything left over behind
// "More". Derived from the one array, so a new section always lands somewhere.
const MOBILE_TABS = 4;
const topBarNav = nav.filter((item) => item.topBar);
const tabNav = nav.filter((item) => !item.topBar);
const primaryNav = tabNav.slice(0, MOBILE_TABS);
const overflowNav = tabNav.slice(MOBILE_TABS);

export function Layout() {
  const { user, logout } = useAuth();
  const { data: serverConfig } = useServerConfig();
  const { data: build } = useServerVersion();
  const t = useT();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const canSee = (item: NavItem) =>
    (!item.adminOnly || user?.isAdmin === true) &&
    (!item.legalOnly || serverConfig?.legal === true);
  const visible = nav.filter(canSee);
  const visibleOverflow = overflowNav.filter(canSee);
  const visibleTopBar = topBarNav.filter(canSee);
  // Whether the open page lives behind "More", so that tab can show as active.
  const inOverflow = visibleOverflow.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop sidebar. Pinned to the viewport rather than stretched by the
          row: as a plain flex child it grew to the height of the content beside
          it, so mt-auto pushed sign-out to the bottom of a very tall column and
          a long page (Settings) left it below the fold. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r p-4 md:sticky md:top-0 md:flex md:h-dvh">
        <div className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold">
          <BrandIcon className="size-5" /> gotracks
        </div>
        {/* Scrolls on its own if the sections ever outgrow the viewport, so
            the account block below stays reachable either way. */}
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {visible.map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "hover:bg-accent/60"
                )
              }
            >
              <Icon className="size-4" /> {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t pt-4">
          <p className="px-3 text-sm text-muted-foreground">{user?.email}</p>
          <Button variant="ghost" className="w-full justify-start" onClick={logout}>
            <LogOut /> {t("nav.signOut")}
          </Button>
          <LegalLinks className="px-3 text-xs text-muted-foreground" />
          {/* Last line of the column: the build this server is running, so a
              bug report can name the release it came from. */}
          {build?.version && (
            <p className="px-3 text-xs text-muted-foreground">gotracks {build.version}</p>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 p-4 backdrop-blur md:hidden">
        <div className="flex items-center gap-2 font-semibold">
          <BrandIcon className="size-5" /> gotracks
        </div>
        <div className="flex items-center gap-1">
          {visibleTopBar.map(({ to, labelKey, icon: Icon, end }) => (
            <IconButton key={to} asChild variant="ghost" label={t(labelKey)}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => (isActive ? "text-foreground" : "text-muted-foreground")}
              >
                <Icon className="size-5" />
              </NavLink>
            </IconButton>
          ))}
          <IconButton variant="ghost" label={t("nav.signOut")} onClick={logout}>
            <LogOut />
          </IconButton>
        </div>
      </header>

      {/* Content */}
      {/* min-w-0 lets this flex child shrink instead of being pushed past the
          viewport by wide content; overflow-x-clip is the belt-and-braces guard
          so the page body never scrolls sideways (wide tables carry their own
          overflow-x-auto). */}
      <main className="min-w-0 flex-1 overflow-x-clip p-4 pb-24 md:p-8 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {primaryNav.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]",
                isActive ? "text-foreground" : "text-muted-foreground"
              )
            }
          >
            <Icon className="size-5" /> {t(labelKey)}
          </NavLink>
        ))}

        {/* Everything that does not fit a tab. It reads as selected while one
            of its sections is open, so the current place is never unmarked. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]",
            inOverflow ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <MoreHorizontal className="size-5" /> {t("nav.more")}
        </button>
      </nav>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="md:hidden">
          <DialogTitle className="sr-only">{t("nav.more")}</DialogTitle>
          <nav className="grid grid-cols-2 gap-1">
            {visibleOverflow.map(({ to, labelKey, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium",
                    isActive
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "hover:bg-accent/60"
                  )
                }
              >
                <Icon className="size-4 shrink-0" /> {t(labelKey)}
              </NavLink>
            ))}
          </nav>
          <p className="mt-3 border-t px-3 pt-3 text-sm text-muted-foreground">{user?.email}</p>
          {/* The sidebar that carries these on desktop is hidden here, so
              without this a signed-in phone has no route to them at all. */}
          <LegalLinks
            className="px-3 pt-2 text-xs text-muted-foreground"
            onNavigate={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Dialog>
    </div>
  );
}
