import { useState, type FormEvent } from "react";
import { Plus, Trash2, ShieldCheck, Shield, ShieldOff, Gauge, KeyRound, Copy, Check } from "lucide-react";
import {
  useCreateUser,
  useDeleteUser,
  useResetUserTwoFactor,
  useInstanceSettings,
  useUpdateInstanceSettings,
  useUpdateUser,
  useUsers,
} from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
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
import { filterUsers, nextTriState, type TriState } from "@/lib/adminFilter";
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
  const { data: users, isLoading } = useUsers();
  const { data: settings } = useInstanceSettings();
  const updateSettings = useUpdateInstanceSettings();
  const create = useCreateUser();
  const update = useUpdateUser();
  const del = useDeleteUser();
  const resetTwoFactor = useResetUserTwoFactor();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");

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

  const visible = filterUsers(users ?? [], {
    query,
    admin: adminFilter,
    twoFactor: twoFactorFilter,
  });
  // Paged in the browser: the list is already fetched whole and filtered here,
  // so paging it server-side would mean moving the filters there too for no
  // gain at this size.
  const pageStart = Math.min((page - 1) * PAGE_SIZE, Math.max(0, visible.length - 1));
  const paged = visible.slice(pageStart, pageStart + PAGE_SIZE);

  function onCreate(e: FormEvent, onAdded?: () => void) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError("");
    create.mutate(
      { email: email.trim(), password, isAdmin },
      {
        onSuccess: () => {
          setEmail("");
          setPassword("");
          setIsAdmin(false);
          onAdded?.();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : t("common.errorGeneric")),
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
          <div className="flex items-center gap-1">
            <Input
              type="text"
              autoComplete="off"
              placeholder={t("admin.password")}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setCopied(false);
              }}
              className="font-mono"
            />
            <IconButton
              type="button"
              variant="outline"
              label={t("admin.generatePassword")}
              onClick={() => {
                setPassword(generatePassword());
                setCopied(false);
              }}
            >
              <KeyRound />
            </IconButton>
            <IconButton
              type="button"
              variant="outline"
              disabled={!password}
              label={t("admin.copyPassword")}
              onClick={() => {
                void navigator.clipboard?.writeText(password).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
            </IconButton>
          </div>
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
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        </form>
      )}
    >
      {/* Instance-wide switch: turning this off stops strangers creating their
          own accounts, while an admin can still add users below. */}
      <Card className="flex items-start justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">{t("admin.allowRegister")}</p>
          <p className="text-xs text-muted-foreground">{t("admin.allowRegisterHelp")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            id="allow-register"
            checked={settings?.allowRegister ?? false}
            disabled={!settings || updateSettings.isPending}
            onCheckedChange={(checked) => updateSettings.mutate({ allowRegister: checked })}
            aria-label={t("admin.allowRegister")}
          />
          <Label htmlFor="allow-register" className="cursor-pointer">
            {settings?.allowRegister ? t("common.on") : t("common.off")}
          </Label>
        </div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
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

      {!isLoading && users && (
        <p className="text-xs text-muted-foreground">
          {tn(users.length, "admin.matchCount", { visible: visible.length, total: users.length })}
        </p>
      )}

      <ul className="space-y-2">
        {paged.map((u) => (
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

      <Pagination page={page} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} />

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
