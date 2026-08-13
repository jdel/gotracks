import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Shield, ShieldCheck, ShieldOff, Gauge, Mail, Info } from "lucide-react";
import {
  useCreateUser,
  useDeleteUser,
  useResendUserInvitation,
  useResetUserTwoFactor,
  useUpdateUser,
  useUsers,
  type UserSort,
} from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { useDateFmt } from "@/lib/datefmt";
import { useT, useTn, type TFunc } from "@/lib/i18n";
import { IconButton } from "@/components/IconButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserUsageDialog } from "@/components/UserUsageDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/Pagination";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/SearchInput";
import { Label } from "@/components/ui/label";
import { initials } from "@/lib/initials";
import { Button, Chip, DataTable, EmptyState, Fab, HeaderBlock, Screen, Sheet, SkeletonList, Toggle } from "@/components/primitives";
import { ApiError } from "@/lib/api";
import { nextTriState, type TriState } from "@/lib/adminFilter";
import { cn } from "@/lib/utils";
import type { AdminUser } from "@/lib/types";

/** Label for a tri-state filter button, so its current meaning is readable. */
function triLabel(t: TFunc, name: string, state: TriState): string {
  switch (state) {
    case "on":
      return t("admin.triOn", { name });
    case "off":
      return t("admin.triOff", { name });
    default:
      return t("admin.triAll", { name });
  }
}

export function AdminPage() {
  const t = useT();
  const tn = useTn();
  const fmt = useDateFmt();
  const { user } = useAuth();
  const create = useCreateUser();
  const update = useUpdateUser();
  const del = useDeleteUser();
  const resetTwoFactor = useResetUserTwoFactor();
  const resendInvitation = useResendUserInvitation();

  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  // The add-user form and the row actions report separately: they appear in
  // different places on the page, and sharing one value printed every failure
  // twice.
  const [addError, setAddError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [query, setQuery] = useState("");
  const [adminFilter, setAdminFilter] = useState<TriState>("all");
  const [twoFactorFilter, setTwoFactorFilter] = useState<TriState>("all");
  // Destructive actions are confirmed first; the pending one is held here.
  const [confirmingDelete, setConfirmingDelete] = useState<AdminUser | null>(null);
  const [confirmingReset, setConfirmingReset] = useState<AdminUser | null>(null);
  // Usage is its own overlay rather than columns in the list: seven counts per
  // account would be run on every page load to show numbers read one at a time.
  const [showingUsage, setShowingUsage] = useState<AdminUser | null>(null);
  // Mobile shows the row's details (created / verified / 2FA + reset/resend) in
  // a dialog behind the ⓘ, since the desktop columns aren't there.
  const [showingDetails, setShowingDetails] = useState<AdminUser | null>(null);

  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Search hits the server, so debounce it rather than firing a request per
  // keystroke. The tri-state filters map "all" to no filter.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);
  const tri = (s: TriState) => (s === "all" ? "" : s);

  // Ordering is the server's job — the list is paginated, so sorting here would
  // only reorder the page on screen.
  const [sort, setSort] = useState<UserSort>("");
  const [desc, setDesc] = useState(false);

  // First click sorts ascending, a second flips it, a third clears back to the
  // default order.
  function toggleSort(column: Exclude<UserSort, "">) {
    setPage(1);
    if (sort !== column) {
      setSort(column);
      setDesc(false);
    } else if (!desc) {
      setDesc(true);
    } else {
      setSort("");
      setDesc(false);
    }
  }

  const { data, isLoading } = useUsers(page, PAGE_SIZE, {
    q: debouncedQuery,
    admin: tri(adminFilter),
    twoFactor: tri(twoFactorFilter),
    sort,
    desc,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  function onCreate(e: FormEvent, onAdded?: () => void) {
    e.preventDefault();
    if (!email.trim()) return;
    setAddError("");
    setNotice("");
    const invitedEmail = email.trim();
    create.mutate(
      { email: invitedEmail, isAdmin },
      {
        onSuccess: () => {
          setEmail("");
          setIsAdmin(false);
          setNotice(t("admin.invitationSent", { email: invitedEmail }));
          onAdded?.();
        },
        onError: (err) =>
          setAddError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
      }
    );
  }

  function act(fn: () => void) {
    setError("");
    fn();
  }

  const createForm = (onAdded?: () => void) => (
    <form onSubmit={(e) => onCreate(e, onAdded)} className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        placeholder={t("admin.email")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="sm:flex-1"
      />
      <div className="flex items-center gap-2 text-sm">
        <Toggle id="new-user-admin" checked={isAdmin} onChange={setIsAdmin} label={t("admin.isAdmin")} />
        <Label htmlFor="new-user-admin" className="cursor-pointer text-ink dark:text-ink-dark">
          {t("admin.isAdmin")}
        </Label>
      </div>
      <Button type="submit" disabled={create.isPending}>
        <Plus /> {t("admin.newUser")}
      </Button>
      {addError && <p className="text-sm font-medium text-danger sm:w-full">{addError}</p>}
    </form>
  );

  const triPill = (
    state: TriState,
    onClick: () => void,
    icon: React.ReactNode,
    label: string,
    title: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={state !== "all"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3.5 py-[7px] text-xs [&_svg]:size-3.5",
        state !== "all"
          ? "bg-brand font-bold text-white dark:bg-brand-dark dark:text-ink"
          : "border border-line bg-card font-semibold text-ink-2 dark:border-line-2-dark dark:bg-card-dark dark:text-ink-2-dark",
      )}
    >
      {icon} {label}
    </button>
  );

  function toggleAdmin(u: AdminUser) {
    act(() =>
      update.mutate(
        { id: u.id, isAdmin: !u.isAdmin },
        { onError: (err) => setError(err instanceof ApiError ? err.message : t("common.errorGeneric")) },
      ),
    );
  }

  function resend(u: AdminUser) {
    act(() =>
      resendInvitation.mutate(u.id, {
        onSuccess: () => setNotice(t("admin.invitationSent", { email: u.email })),
        onError: (err) => setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
      }),
    );
  }

  const usageBtn = (u: AdminUser) => (
    <IconButton  className="size-7" label={t("admin.showUsage", { email: u.email })} onClick={() => setShowingUsage(u)}>
      <Gauge className="size-3.5 text-ink-4" />
    </IconButton>
  );

  // Admin status is the icon itself: teal when admin, muted outline otherwise.
  // Your own row can't be demoted (the server refuses), so it's read-only.
  const adminBtn = (u: AdminUser) => (
    <IconButton
      className="size-7"
      disabled={u.id === user?.id}
      label={u.isAdmin ? t("admin.menuRevokeAdmin") : t("admin.menuMakeAdmin")}
      onClick={() => toggleAdmin(u)}
    >
      <Shield className={cn("size-3.5", u.isAdmin ? "fill-done text-done" : "text-ink-4")} />
    </IconButton>
  );

  const deleteBtn = (u: AdminUser) => (
    <IconButton  className="size-7" label={t("admin.menuDelete")} onClick={() => setConfirmingDelete(u)}>
      <Trash2 className="size-3.5 text-danger" />
    </IconButton>
  );

  const resetBtn = (u: AdminUser) => (
    <IconButton  className="size-7" label={t("admin.menuResetTwoFactor")} onClick={() => setConfirmingReset(u)}>
      <ShieldOff className="size-3.5 text-ink-4" />
    </IconButton>
  );

  const resendBtn = (u: AdminUser) => (
    <IconButton  className="size-7" label={t("admin.menuResendInvitation")} onClick={() => resend(u)}>
      <Mail className="size-3.5 text-ink-4" />
    </IconButton>
  );

  const detailsBtn = (u: AdminUser) => (
    <IconButton  className="size-7" label={t("admin.details")} onClick={() => setShowingDetails(u)}>
      <Info className="size-3.5 text-ink-4" />
    </IconButton>
  );

  // The row's standing, as chips rather than prose: it has to read the same in
  // a table cell and on a card.
  const stateChips = (u: AdminUser) => (
    <span className="flex flex-wrap items-center gap-1">
      {u.id === user?.id && <Chip tone="neutral">{t("admin.you")}</Chip>}
      {u.isAdmin && <Chip tone="brand">{t("admin.chipAdmin")}</Chip>}
      {!u.emailVerifiedAt && <Chip tone="neutral">{t("admin.chipInvited")}</Chip>}
      {/* Both are warnings, so both are danger-toned: one account is on its way
          out, the other cannot create anything more. */}
      {u.deletionRequested && <Chip tone="danger">{t("admin.chipDeleting")}</Chip>}
      {u.overQuota && <Chip tone="danger">{t("admin.chipOverQuota")}</Chip>}
    </span>
  );

  // Desktop: everything inline next to usage. Mobile: usage, details (ⓘ), admin,
  // delete — the rest (reset 2FA, resend) live in the details dialog.
  const desktopActions = (u: AdminUser) => (
    <div className="flex items-center justify-end gap-0.5">
      {usageBtn(u)}
      {adminBtn(u)}
      {u.twoFactorEnabled && resetBtn(u)}
      {!u.emailVerifiedAt && resendBtn(u)}
      {deleteBtn(u)}
    </div>
  );

  const mobileActions = (u: AdminUser) => (
    <div className="flex items-center gap-0.5">
      {usageBtn(u)}
      {detailsBtn(u)}
      {adminBtn(u)}
      {deleteBtn(u)}
    </div>
  );

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("admin.title")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
          metrics={[{ value: total, label: t("admin.metricAccounts") }]}
        />
      }
      fab={<Fab label={t("admin.newUser")} onClick={() => setAdding(true)} />}
    >
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        {createForm()}
      </div>

      {error && <p className="pt-3 text-sm font-medium text-danger">{error}</p>}
      {notice && <p className="pt-3 text-sm font-medium text-done-text dark:text-done-dark">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder={t("admin.searchEmail")}
          ariaLabel={t("admin.searchAria")}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {triPill(
            adminFilter,
            () => {
              setAdminFilter(nextTriState(adminFilter));
              setPage(1);
            },
            <Shield />,
            t("admin.adminFilter", { state: t(`filter.${adminFilter}` as Parameters<TFunc>[0]) }),
            triLabel(t, t("admin.adminRights"), adminFilter),
          )}
          {triPill(
            twoFactorFilter,
            () => {
              setTwoFactorFilter(nextTriState(twoFactorFilter));
              setPage(1);
            },
            <ShieldCheck />,
            t("admin.twoFactorFilter", { state: t(`filter.${twoFactorFilter}` as Parameters<TFunc>[0]) }),
            triLabel(t, t("admin.twoFactorName"), twoFactorFilter),
          )}
        </div>
      </div>

      {!isLoading && data && (
        <p className="pb-3 text-xs font-medium text-ink-4">{tn(total, "admin.matchCount", { count: total })}</p>
      )}

      {isLoading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState message={tn(0, "admin.matchCount", { count: 0 })} />
      ) : (
        <DataTable
          rows={items}
          rowKey={(u) => u.id}
          columns={[
            {
              key: "email",
              label: t("admin.email"),
              sorted: sort === "email" ? (desc ? "desc" : "asc") : undefined,
              onSort: () => toggleSort("email"),
              render: (u) => (
                <span className="block max-w-64 truncate" title={u.email}>
                  {u.email}
                </span>
              ),
            },
            {
              key: "state",
              label: t("admin.state"),
              // Sorted by verification: "invited" is the state the column shows
              // that the server can actually order by, and it groups the
              // accounts that have never proved their address.
              sorted: sort === "verified" ? (desc ? "desc" : "asc") : undefined,
              onSort: () => toggleSort("verified"),
              render: (u) => stateChips(u),
            },
            {
              key: "twoFactor",
              label: t("admin.twoFactorName"),
              align: "right",
              mono: true,
              render: (u) => (u.twoFactorEnabled ? t("common.on") : "—"),
            },
            {
              key: "created",
              label: t("admin.created"),
              align: "right",
              mono: true,
              sorted: sort === "created" ? (desc ? "desc" : "asc") : undefined,
              onSort: () => toggleSort("created"),
              render: (u) => fmt.date(u.createdAt),
            },
            { key: "actions", label: "", align: "right", render: (u) => desktopActions(u) },
          ]}
          renderCard={(u) => (
            <div
              key={u.id}
              className="flex items-start gap-2.5 rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-sm font-bold text-ink dark:text-ink-dark">
                  {u.email}
                </span>
                {stateChips(u)}
              </div>
              {mobileActions(u)}
            </div>
          )}
        />
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("admin.newUser")}>
        {createForm(() => setAdding(false))}
      </Sheet>

      <UserUsageDialog user={showingUsage} onOpenChange={(open) => !open && setShowingUsage(null)} />

      <Dialog open={showingDetails !== null} onOpenChange={(open) => !open && setShowingDetails(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="truncate">{showingDetails?.email}</DialogTitle>
          </DialogHeader>
          {showingDetails && (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-medium text-ink-3 dark:text-ink-4-dark">{t("admin.created")}</dt>
                  <dd className="mono text-ink dark:text-ink-dark">{fmt.date(showingDetails.createdAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-medium text-ink-3 dark:text-ink-4-dark">{t("admin.verified")}</dt>
                  <dd className="mono text-ink dark:text-ink-dark">
                    {showingDetails.emailVerifiedAt ? fmt.date(showingDetails.emailVerifiedAt) : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="font-medium text-ink-3 dark:text-ink-4-dark">{t("admin.twoFactorName")}</dt>
                  <dd className="mono text-ink dark:text-ink-dark">
                    {showingDetails.twoFactorEnabled ? t("common.on") : t("common.off")}
                  </dd>
                </div>
              </dl>
              {(showingDetails.twoFactorEnabled || !showingDetails.emailVerifiedAt) && (
                <div className="flex flex-wrap gap-2 border-t border-line-3 pt-3 dark:border-line-dark">
                  {showingDetails.twoFactorEnabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirmingReset(showingDetails);
                        setShowingDetails(null);
                      }}
                    >
                      <ShieldOff /> {t("admin.menuResetTwoFactor")}
                    </Button>
                  )}
                  {!showingDetails.emailVerifiedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resend(showingDetails);
                        setShowingDetails(null);
                      }}
                    >
                      <Mail /> {t("admin.menuResendInvitation")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
        title={t("admin.deleteTitle", { email: confirmingDelete?.email ?? "" })}
        description={
<>{t("admin.deleteDesc")}</>
        }
        busy={del.isPending}
        onConfirm={() => {
          const target = confirmingDelete;
          setConfirmingDelete(null);
          if (target) {
            act(() => del.mutate(target.id, {
              onError: (err) => setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
            }));
          }
        }}
      />

      <ConfirmDialog
        open={confirmingReset !== null}
        onOpenChange={(open) => !open && setConfirmingReset(null)}
        title={t("admin.resetTitle", { email: confirmingReset?.email ?? "" })}
        description={
<>{t("admin.resetDesc")}</>
        }
        confirmLabel={t("admin.removeTwoFactorBtn")}
        busy={resetTwoFactor.isPending}
        onConfirm={() => {
          const target = confirmingReset;
          setConfirmingReset(null);
          if (target) {
            act(() => resetTwoFactor.mutate(target.id, {
              onError: (err) => setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
            }));
          }
        }}
      />
    </Screen>
  );
}
