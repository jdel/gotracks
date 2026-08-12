import { useState, type FormEvent } from "react";
import { Plus, Trash2, EyeOff, Eye } from "lucide-react";
import {
  useContexts,
  useCreateContext,
  useDeleteContext,
  useUpdateContext,
} from "@/hooks/useContexts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Fab, Sheet, SkeletonList, EmptyState } from "@/components/primitives";
import { rowActions, inlineEdit } from "@/components/primitive-styles";
import { ApiError, apiMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT, useTn } from "@/lib/i18n";

/** The add-context form: one field, used both permanently on desktop and inside
 *  the mobile add sheet, which onAdded closes. */
function ContextAddForm({ onAdded }: { onAdded: () => void }) {
  const t = useT();
  const create = useCreateContext();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function onAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError("");
    create.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          onAdded();
        },
        onError: (err) => setError(apiMessage(err, t("contexts.errorAdd"))),
      },
    );
  }

  return (
    <form onSubmit={onAdd} className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder={t("contexts.new")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          <Plus /> {t("common.add")}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function ContextsPage() {
  const t = useT();
  const tn = useTn();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const { data: contexts, isLoading, error: loadError } = useContexts();
  const del = useDeleteContext();
  const update = useUpdateContext();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  // The context being renamed inline, and the working text for it.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // Set when a delete was refused because the context still holds things; it
  // carries what would be destroyed so the user can be told before confirming.
  const [confirming, setConfirming] = useState<{
    id: number;
    name: string;
    todos: number;
    recurring: number;
  } | null>(null);

  // Commit an inline rename. No-ops on an empty or unchanged name so a stray
  // click that opens and blurs the field costs nothing.
  function saveRename(id: number, current: string) {
    const name = draft.trim();
    setEditingId(null);
    if (!name || name === current) return;
    update.mutate(
      { id, name },
      { onError: (err) => setError(apiMessage(err, t("contexts.loadError"))) },
    );
  }

  // First attempt never forces: an empty context just goes, and a full one
  // comes back with the counts to warn about.
  function onDelete(id: number, contextName: string) {
    setError("");
    del.mutate(
      { id },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConfirming({
              id,
              name: contextName,
              todos: Number(err.details.todos ?? 0),
              recurring: Number(err.details.recurring ?? 0),
            });
            return;
          }
          setError(apiMessage(err, t("contexts.errorDelete")));
        },
      },
    );
  }

  function onConfirmDelete() {
    if (!confirming) return;
    const { id } = confirming;
    setConfirming(null);
    del.mutate(
      { id, force: true },
      { onError: (err) => setError(apiMessage(err, t("contexts.errorDelete"))) },
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = (contexts ?? []).filter((c) => c.name.toLowerCase().includes(needle));

  return (
    <Screen
      header={<HeaderBlock title={t("nav.contexts")} avatar={initials(user?.email)} avatarLabel={t("nav.settings")} />}
      fab={<Fab label={t("contexts.addTitle")} onClick={() => setAdding(true)} />}
    >
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <ContextAddForm onAdded={() => {}} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("contexts.searchPlaceholder")}
          ariaLabel={t("contexts.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
      </div>

      {loadError && <p className="pb-3 text-sm font-medium text-danger">{t("contexts.loadError")}</p>}
      {error && <p className="pb-3 text-sm font-medium text-danger">{error}</p>}

      {isLoading ? (
        <SkeletonList />
      ) : contexts?.length === 0 ? (
        <EmptyState message={t("contexts.none")} />
      ) : visible.length === 0 ? (
        <EmptyState message={t("contexts.noMatch")} />
      ) : (
      <ul className="flex flex-col gap-[9px]">
        {visible.map((c) => (
          <li
            key={c.id}
            className="group relative flex items-start justify-between gap-2.5 rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
          >
              {editingId === c.id ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(c.id, c.name);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => saveRename(c.id, c.name)}
                  aria-label={t("contexts.renameLabel")}
                  className={cn(inlineEdit, "min-w-0 flex-1 text-sm font-semibold text-ink dark:text-ink-dark")}
                />
              ) : (
                // Single click starts an inline rename.
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setDraft(c.name);
                  }}
                  title={t("contexts.renameLabel")}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded px-1 text-left text-sm font-semibold text-ink dark:text-ink-dark",
                    c.state === "hidden" && "text-ink-4 line-through dark:text-ink-4-dark",
                  )}
                >
                  {c.name}
                </button>
              )}
              <div className={rowActions}>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={c.state === "hidden" ? t("contexts.show") : t("contexts.hide")}
                  onClick={() =>
                    update.mutate({ id: c.id, state: c.state === "hidden" ? "active" : "hidden" })
                  }
                >
                  {c.state === "hidden" ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </IconButton>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={t("contexts.deleteLabel", { name: c.name })}
                  onClick={() => onDelete(c.id, c.name)}
                >
                  <Trash2 className="size-3.5 text-danger" />
                </IconButton>
              </div>
          </li>
        ))}
      </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("contexts.addTitle")}>
        <ContextAddForm onAdded={() => setAdding(false)} />
      </Sheet>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("contexts.deleteTitle", { name: confirming?.name ?? "" })}
        description={
          <>
            {t("contexts.deleteAlso")}{" "}
            {confirming && confirming.todos > 0 && (
              <strong>{tn(confirming.todos, "contexts.actionCount")}</strong>
            )}
            {confirming && confirming.todos > 0 && confirming.recurring > 0 && ` ${t("contexts.and")} `}
            {confirming && confirming.recurring > 0 && (
              <strong>{tn(confirming.recurring, "contexts.recurringCount")}</strong>
            )}
            {t("contexts.deleteRest")}
          </>
        }
        confirmLabel={t("contexts.deleteEverything")}
        busy={del.isPending}
        onConfirm={onConfirmDelete}
      />
    </Screen>
  );
}
