import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, ShieldCheck, Shield, ShieldOff, Gauge, Mail } from "lucide-react";
import {
  useCreateUser,
  useDeleteUser,
  useResendUserInvitation,
  useResetUserTwoFactor,
  useUpdateUser,
  useUsers,
} from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { useT, useTn, type TFunc } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UserUsageDialog } from "@/components/UserUsageDialog";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PageWithAdd } from "@/components/PageWithAdd";
import { Pagination } from "@/components/Pagination";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/SearchInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { nextTriState, type TriState } from "@/lib/adminFilter";
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

  const { data, isLoading } = useUsers(page, PAGE_SIZE, {
    q: debouncedQuery,
    admin: tri(adminFilter),
    twoFactor: tri(twoFactorFilter),
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

  return (
    <PageWithAdd
      title={t("admin.title")}
      subtitle={t("admin.subtitle")}
      addLabel={t("admin.newUser")}
      size="wide"
      renderForm={(onAdded) => (
        <form
          onSubmit={(e) => onCreate(e, onAdded)}
          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
        >
          <Input placeholder={t("admin.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex items-center gap-2 text-sm">
            <Switch
              id="new-user-admin"
              checked={isAdmin}
              onCheckedChange={setIsAdmin}
              aria-label={t("admin.isAdmin")}
            />
            <Label htmlFor="new-user-admin" className="cursor-pointer">
              {t("admin.isAdmin")}
            </Label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              <Plus /> {t("admin.newUser")}
            </Button>
          </div>
          {addError && <p className="text-sm text-destructive sm:col-span-2">{addError}</p>}
        </form>
      )}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">{t("actions.loading")}</p>}

      {/* Search and filters. The tri-state buttons cycle all → on → off.
          Stacked on a phone — search on its own row, the two toggles sharing
          the row beneath — and back on one line once there is width for it. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          className="sm:min-w-48 sm:flex-1"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder={t("admin.searchEmail")}
          ariaLabel={t("admin.searchAria")}
        />
        <div className="flex gap-2">
          <Button
            variant={adminFilter === "all" ? "outline" : "default"}
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => {
              setAdminFilter(nextTriState(adminFilter));
              setPage(1);
            }}
            title={triLabel(t, t("admin.adminRights"), adminFilter)}
          >
            <Shield /> {t("admin.adminFilter", { state: t(`filter.${adminFilter}` as Parameters<TFunc>[0]) })}
          </Button>
          <Button
            variant={twoFactorFilter === "all" ? "outline" : "default"}
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => {
              setTwoFactorFilter(nextTriState(twoFactorFilter));
              setPage(1);
            }}
            title={triLabel(t, t("admin.twoFactorName"), twoFactorFilter)}
          >
            <ShieldCheck /> {t("admin.twoFactorFilter", { state: t(`filter.${twoFactorFilter}` as Parameters<TFunc>[0]) })}
          </Button>
        </div>
      </div>

      {!isLoading && data && (
        <p className="text-xs text-muted-foreground">
          {tn(total, "admin.matchCount", { count: total })}
        </p>
      )}

      <ul className="space-y-2">
        {items.map((u) => (
          <li key={u.id}>
            <Card className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {u.email}
                  {u.id === user?.id && (
                    <span className="ml-2 text-xs text-muted-foreground">{t("admin.you")}</span>
                  )}
                </p>
                {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                {u.twoFactorEnabled && (
                  <p className="text-xs text-emerald-600">{t("admin.twoFactorOn")}</p>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                {/* Primary action inline; the rest collapse into the ⋯ menu so
                    a row never shows more than a couple of icons. */}
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={t("admin.showUsage", { email: u.email })}
                  onClick={() => setShowingUsage(u)}
                >
                  <Gauge className="size-4 text-muted-foreground" />
                </IconButton>
                <OverflowMenu
                  label={t("common.moreActions")}
                  actions={[
                    // No admin-toggle on your own row: the server refuses a
                    // self-demotion, and you are already an admin.
                    ...(u.id !== user?.id
                      ? [
                          {
                            label: u.isAdmin ? t("admin.menuRevokeAdmin") : t("admin.menuMakeAdmin"),
                            icon: u.isAdmin ? (
                              <ShieldCheck className="size-4 text-emerald-600" />
                            ) : (
                              <Shield className="size-4" />
                            ),
                            onSelect: () =>
                              act(() =>
                                update.mutate(
                                  { id: u.id, isAdmin: !u.isAdmin },
                                  {
                                    onError: (err) =>
                                      setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
                                  },
                                ),
                              ),
                          },
                        ]
                      : []),
                    // Only when the user has 2FA: an admin is the only way back
                    // in for someone who lost both their authenticator and codes.
                    ...(u.twoFactorEnabled
                      ? [
                          {
                            label: t("admin.menuResetTwoFactor"),
                            icon: <ShieldOff className="size-4" />,
                            onSelect: () => setConfirmingReset(u),
                          },
                        ]
                      : []),
                    ...(!u.emailVerifiedAt
                      ? [
                          {
                            label: t("admin.menuResendInvitation"),
                            icon: <Mail className="size-4" />,
                            onSelect: () =>
                              act(() =>
                                resendInvitation.mutate(u.id, {
                                  onSuccess: () => setNotice(t("admin.invitationSent", { email: u.email })),
                                  onError: (err) =>
                                    setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
                                }),
                              ),
                          },
                        ]
                      : []),
                    {
                      label: t("admin.menuDelete"),
                      icon: <Trash2 className="size-4" />,
                      onSelect: () => setConfirmingDelete(u),
                      destructive: true,
                    },
                  ]}
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <UserUsageDialog user={showingUsage} onOpenChange={(open) => !open && setShowingUsage(null)} />

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
    </PageWithAdd>
  );
}
