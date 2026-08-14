import { useState } from "react";
import { Trash2, Repeat, Pause, Play, Pencil } from "lucide-react";
import { useDeleteRecurring, useRecurring, useUpdateRecurring } from "@/hooks/useRecurring";
import { useContexts } from "@/hooks/useContexts";
import { useProjects } from "@/hooks/useProjects";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { RecurringForm } from "@/components/RecurringForm";
import { weekdayShort } from "@/lib/recurrence";
import { useUndo } from "@/lib/undo";
import { useT, useTn, type TFunc, type TnFunc } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { IconButton } from "@/components/IconButton";
import type { Context, Project, RecurringTodo } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Chip, Screen, HeaderBlock, Fab, Sheet, SkeletonList, EmptyState } from "@/components/primitives";
import { rowActions } from "@/components/primitive-styles";
import { cn } from "@/lib/utils";

// describe renders a pattern as a human sentence, translated, e.g.
// "Every 2 weeks on Mon, Fri".
function describe(t: TFunc, tn: TnFunc, r: RecurringTodo): string {
  switch (r.period) {
    case "daily":
      return tn(r.everyN, "recurring.desc.daily");
    case "weekly": {
      const names = r.weekdays
        .split(",")
        .map((d) => weekdayShort(t, Number(d)))
        .filter(Boolean)
        .join(", ");
      const days = names ? ` ${t("recurring.on", { days: names })}` : "";
      return tn(r.everyN, "recurring.desc.weekly", { days });
    }
    case "monthly":
      return tn(r.everyN, "recurring.desc.monthly", { day: r.dayOfMonth || 1 });
    case "yearly":
      return tn(r.everyN, "recurring.desc.yearly", { month: r.monthOfYear || 1, day: r.dayOfMonth || 1 });
    default:
      return r.period;
  }
}

/**
 * One pattern in the list.
 *
 * The editor opens where an action's does: expanded inside the card on a
 * desktop, and on a phone as a sheet the page owns — held, not tapped, because
 * a row with no hover has nowhere to put a pencil.
 */
function PatternRow({
  pattern,
  contexts,
  projects,
  editing,
  onEdit,
  onCloseEditor,
}: {
  pattern: RecurringTodo;
  contexts: Context[];
  projects: Project[];
  editing: boolean;
  onEdit: () => void;
  onCloseEditor: () => void;
}) {
  const t = useT();
  const tn = useTn();
  const fmt = useDateFmt();
  const isDesktop = useIsDesktop();
  const update = useUpdateRecurring();
  const del = useDeleteRecurring();
  const { schedule } = useUndo();

  return (
    <li
      className="group relative flex flex-col rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
      <div className="flex items-start gap-2.5">
        <Repeat className="mt-0.5 size-4 shrink-0 text-ink-4" />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-semibold text-ink dark:text-ink-dark",
              pattern.state === "completed" && "text-ink-4 line-through dark:text-ink-4-dark",
            )}
          >
            {pattern.description}
          </p>
          {pattern.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 overflow-hidden">
              {/* Shown on the pattern because every action it spawns will
                  carry them. */}
              {pattern.tags.map((tag) => (
                <Chip key={tag} tone="neutral">
                  !{tag}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs font-medium text-ink-3 dark:text-ink-4-dark">
            {describe(t, tn, pattern)}
            {pattern.lastSpawnedAt && (
              <>
                {" · "}
                <span className="mono">
                  {t("recurring.last", { date: fmt.date(pattern.lastSpawnedAt) })}
                </span>
              </>
            )}
          </p>
        </div>
        <div className={rowActions}>
          {/* At every width. Holding the row used to do this on a phone, but
              the browser reads a hold as "select this text" and put its own
              selection handles over the editor. */}
          <IconButton
            className="size-7"
            label={t("recurring.editLabel")}
            onClick={editing ? onCloseEditor : onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton
            className="size-7"
            label={pattern.state === "completed" ? t("recurring.resume") : t("recurring.pause")}
            onClick={() =>
              update.mutate({
                id: pattern.id,
                state: pattern.state === "completed" ? "active" : "completed",
              })
            }
          >
            {pattern.state === "completed" ? (
              <Play className="size-3.5" />
            ) : (
              <Pause className="size-3.5" />
            )}
          </IconButton>
          <IconButton
            className="size-7"
            label={t("recurring.deleteLabel", { description: pattern.description })}
            onClick={() =>
              schedule(`recurring:${pattern.id}`, t("recurring.deleted"), () =>
                del.mutate(pattern.id),
              )
            }
          >
            <Trash2 className="size-3.5 text-danger" />
          </IconButton>
        </div>
      </div>

      {/* Exactly one presentation is mounted. A sheet renders through a portal,
          so hiding it with a class cannot reach it — the desktop would get the
          inline panel and a modal over the top of it. */}
      {isDesktop && editing && (
        <div className="mt-3">
          <RecurringForm
            pattern={pattern}
            contexts={contexts}
            projects={projects}
            onDone={onCloseEditor}
          />
        </div>
      )}
    </li>
  );
}

export function RecurringPage() {
  const t = useT();
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data: patterns, isLoading } = useRecurring();
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects("active");
  const { pendingKey } = useUndo();
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  // A pattern pending deletion leaves the list at once; the toast's Undo puts it
  // back, and only the toast expiring makes the delete real.
  const visible = (patterns ?? []).filter(
    (p) => p.description.toLowerCase().includes(needle) && pendingKey !== `recurring:${p.id}`,
  );
  const editingPattern = visible.find((p) => p.id === editingId) ?? null;

  return (
    <Screen
      header={<HeaderBlock title={t("nav.recurring")} avatar={initials(user?.email)} avatarLabel={t("nav.settings")} />}
      fab={<Fab label={t("recurring.addTitle")} onClick={() => setAdding(true)} />}
    >
      <div className="mt-3.5 hidden rounded-lg border p-3 md:block">
        <RecurringForm contexts={contexts ?? []} projects={projects ?? []} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("recurring.searchPlaceholder")}
          ariaLabel={t("recurring.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : patterns?.length === 0 ? (
        <EmptyState message={t("recurring.none")} />
      ) : visible.length === 0 ? (
        <EmptyState message={t("recurring.noMatch")} />
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {visible.map((p) => (
            <PatternRow
              key={p.id}
              pattern={p}
              contexts={contexts ?? []}
              projects={projects ?? []}
              editing={editingId === p.id}
              onEdit={() => setEditingId(p.id)}
              onCloseEditor={() => setEditingId(null)}
            />
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("recurring.addTitle")}>
        <RecurringForm
          contexts={contexts ?? []}
          projects={projects ?? []}
          onDone={() => setAdding(false)}
        />
      </Sheet>

      {/* Editing on a phone. Keyed on the pattern so the draft belongs to the
          one being edited rather than to whichever was opened first. */}
      {!isDesktop && editingPattern && (
        <Sheet
          open
          onClose={() => setEditingId(null)}
          title={t("recurring.editTitle")}
        >
          <RecurringForm
            key={editingPattern.id}
            pattern={editingPattern}
            contexts={contexts ?? []}
            projects={projects ?? []}
            onDone={() => setEditingId(null)}
          />
        </Sheet>
      )}
    </Screen>
  );
}
