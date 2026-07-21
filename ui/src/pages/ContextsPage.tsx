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
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/SearchInput";
import { PageWithAdd } from "@/components/PageWithAdd";
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
    <PageWithAdd
      title={t("nav.contexts")}
      subtitle={t("contexts.subtitle")}
      addLabel={t("contexts.addTitle")}
      widthClass="max-w-2xl"
      renderForm={(onAdded) => <ContextAddForm onAdded={onAdded} />}
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("contexts.searchPlaceholder")}
        ariaLabel={t("contexts.searchAria")}
      />

      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {loadError && <p className="text-sm text-destructive">{t("contexts.loadError")}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-2">
        {visible.map((c) => (
          <li key={c.id}>
            <Card className="flex items-center justify-between p-3">
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
                  className="h-8 max-w-xs"
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
                    "rounded px-1 text-left hover:bg-accent/40",
                    c.state === "hidden" && "text-muted-foreground line-through",
                  )}
                >
                  {c.name}
                </button>
              )}
              <div className="flex gap-1">
                <IconButton
                  variant="ghost"
                  label={c.state === "hidden" ? t("contexts.show") : t("contexts.hide")}
                  onClick={() =>
                    update.mutate({ id: c.id, state: c.state === "hidden" ? "active" : "hidden" })
                  }
                >
                  {c.state === "hidden" ? <Eye /> : <EyeOff />}
                </IconButton>
                <IconButton
                  variant="ghost"
                  label={t("contexts.deleteLabel", { name: c.name })}
                  onClick={() => onDelete(c.id, c.name)}
                >
                  <Trash2 className="text-destructive" />
                </IconButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {contexts?.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground">{t("contexts.none")}</p>
      )}
      {contexts && contexts.length > 0 && visible.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("contexts.noMatch")}</p>
      )}

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
    </PageWithAdd>
  );
}
