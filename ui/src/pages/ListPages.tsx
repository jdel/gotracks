import { useState } from "react";
import { useT, type TFunc } from "@/lib/i18n";
import { useTodos } from "@/hooks/useTodos";
import { useTags } from "@/hooks/useProjects";
import { useContexts } from "@/hooks/useContexts";
import { useAllAttachments } from "@/hooks/useSettings";
import { useAuth } from "@/lib/auth";
import { useDateFmt } from "@/lib/datefmt";
import { initials } from "@/lib/initials";
import { TodoItem } from "@/components/TodoItem";
import { SearchInput } from "@/components/SearchInput";
import {
  Screen,
  HeaderBlock,
  List,
  GroupHeader,
  Chip,
  SkeletonList,
  EmptyState,
} from "@/components/primitives";
import { nextTriState, type TriState } from "@/lib/adminFilter";
import { cn } from "@/lib/utils";
import type { Todo } from "@/lib/types";

/** Whether an action passes a yes/no/all switch on a boolean it has. */
function passesTri(value: boolean, state: TriState): boolean {
  return state === "all" ? true : state === "on" ? value : !value;
}

/** Which date a list groups its rows by, if it groups them at all. */
type GroupBy = "showFrom" | "completedAt";

// TodoList renders a titled list of actions with a search box. `richFilters`
// adds yes/no/all switches for attachments and stars — used on the Done
// archive, where narrowing by "had files" or "was starred" is worth the space.
// `groupBy` puts a date heading over each run of rows.
function TodoList({
  title,
  filter,
  empty,
  richFilters = false,
  groupBy,
}: {
  title: string;
  filter: Parameters<typeof useTodos>[0];
  empty: string;
  richFilters?: boolean;
  groupBy?: GroupBy;
}) {
  const t = useT();
  const { user } = useAuth();
  const fmt = useDateFmt();
  const { data: todos, isLoading } = useTodos(filter);
  const { data: contexts } = useContexts();
  const { data: attachments } = useAllAttachments();
  const contextName = (id: number) => contexts?.find((c) => c.id === id)?.name;

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<TriState>("all");
  const [starred, setStarred] = useState<TriState>("all");

  const withFiles = new Set((attachments ?? []).map((a) => a.todoId));

  const needle = query.trim().toLowerCase();
  const visible = (todos ?? []).filter((todo: Todo) => {
    if (
      needle &&
      !todo.description.toLowerCase().includes(needle) &&
      !todo.tags.some((tag) => tag.toLowerCase().includes(needle))
    ) {
      return false;
    }
    if (richFilters && !passesTri(withFiles.has(todo.id), files)) return false;
    if (richFilters && !passesTri(todo.starred, starred)) return false;
    return true;
  });

  // Runs of rows sharing a calendar day. The server sorts by position — the
  // drag-reorder order the context lists need — so a date-grouped list has to
  // sort for itself, or the headers come out in position order and one date
  // appears under several separate headings. The tickler reads forwards, the
  // archive backwards.
  const groups: { key: string; label: string; rows: Todo[] }[] = [];
  if (groupBy) {
    const today = fmt.dayKey(new Date().toISOString());
    const direction = groupBy === "showFrom" ? 1 : -1;
    const ordered = [...visible].sort((a, b) => {
      // Undated rows sink to the end of either list rather than colliding with
      // the earliest real date.
      const av = a[groupBy] ?? "";
      const bv = b[groupBy] ?? "";
      if (!av || !bv) return av ? -1 : bv ? 1 : 0;
      return av < bv ? -direction : av > bv ? direction : 0;
    });
    for (const todo of ordered) {
      const iso = todo[groupBy];
      const key = iso ? fmt.dayKey(iso) : "";
      const last = groups.at(-1);
      if (last?.key === key) {
        last.rows.push(todo);
        continue;
      }
      const label = !iso
        ? t("list.groupUndated")
        : key === today
          ? `${t("list.groupToday")} · ${fmt.weekday(iso)}`
          : fmt.weekday(iso);
      groups.push({ key, label, rows: [todo] });
    }
  }

  return (
    <Screen header={<HeaderBlock title={title} avatar={initials(user?.email)} />}>
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
          value={query}
          onChange={setQuery}
          placeholder={t("list.searchPlaceholder")}
          ariaLabel={t("list.searchAria")}
        />
        {richFilters && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <TriButton
              t={t}
              labelKey="list.filesFilter"
              state={files}
              onClick={() => setFiles(nextTriState(files))}
            />
            <TriButton
              t={t}
              labelKey="list.starredFilter"
              state={starred}
              onClick={() => setStarred(nextTriState(starred))}
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : todos && todos.length === 0 ? (
        <EmptyState message={empty} />
      ) : visible.length === 0 ? (
        <EmptyState message={t("list.noMatch")} />
      ) : groupBy ? (
        <div className="flex flex-col gap-3">
          {/* Keyed by position as well as day: an unsorted list can produce two
              separate runs that fall on the same date. */}
          {groups.map((group, i) => (
            <div key={`${group.key}-${i}`} className="flex flex-col gap-2">
              <GroupHeader label={group.label} count={group.rows.length} />
              <List>
                {group.rows.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} showContext={contextName(todo.contextId)} />
                ))}
              </List>
            </div>
          ))}
        </div>
      ) : (
        <List>
          {visible.map((todo) => (
            <TodoItem key={todo.id} todo={todo} showContext={contextName(todo.contextId)} />
          ))}
        </List>
      )}
    </Screen>
  );
}

/** A yes/no/all filter pill whose label reflects its current state. */
function TriButton({
  t,
  labelKey,
  state,
  onClick,
}: {
  t: TFunc;
  labelKey: "list.filesFilter" | "list.starredFilter";
  state: TriState;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={state !== "all"}
      className={cn(
        "rounded-full px-3.5 py-[7px] text-xs",
        state !== "all"
          ? "bg-brand font-bold text-white dark:bg-brand-dark dark:text-ink"
          : "border border-line bg-card font-semibold text-ink-2 dark:border-line-2-dark dark:bg-card-dark dark:text-ink-2-dark",
      )}
    >
      {t(labelKey, { state: t(`filter.${state}` as Parameters<TFunc>[0]) })}
    </button>
  );
}

export function TicklerPage() {
  const t = useT();
  return (
    <TodoList
      title={t("tickler.title")}
      filter={{ state: "deferred" }}
      empty={t("tickler.empty")}
      groupBy="showFrom"
    />
  );
}

export function StarredPage() {
  const t = useT();
  return (
    <TodoList
      title={t("starred.title")}
      filter={{ starred: true, state: "active" }}
      empty={t("starred.empty")}
    />
  );
}

export function DonePage() {
  const t = useT();
  return (
    <TodoList
      title={t("done.title")}
      filter={{ state: "completed" }}
      empty={t("done.empty")}
      richFilters
      groupBy="completedAt"
    />
  );
}

export function TagsPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: tags } = useTags();
  const [selected, setSelected] = useState<string | null>(null);
  const { data: todos } = useTodos(selected ? { tag: selected } : {});
  const { data: contexts } = useContexts();
  const contextName = (id: number) => contexts?.find((c) => c.id === id)?.name;

  return (
    <Screen header={<HeaderBlock title={t("nav.tags")} avatar={initials(user?.email)} />}>
      {tags?.length === 0 ? (
        <EmptyState message={t("tags.emptyList")} />
      ) : (
        <div className="flex flex-wrap gap-1.5 pb-4">
          {tags?.map((tag) => (
            <button key={tag.id} type="button" onClick={() => setSelected(selected === tag.name ? null : tag.name)}>
              <Chip tone={selected === tag.name ? "brand" : "neutral"}>{tag.name}</Chip>
            </button>
          ))}
        </div>
      )}

      {selected &&
        (todos && todos.length === 0 ? (
          <EmptyState message={t("tags.emptyForTag")} />
        ) : (
          <List>
            {todos?.map((todo) => (
              <TodoItem key={todo.id} todo={todo} showContext={contextName(todo.contextId)} />
            ))}
          </List>
        ))}
    </Screen>
  );
}
