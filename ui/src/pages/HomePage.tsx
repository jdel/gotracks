import { useState } from "react";
import { useContexts } from "@/hooks/useContexts";
import { useT } from "@/lib/i18n";
import { useTodos } from "@/hooks/useTodos";
import { useAuth } from "@/lib/auth";
import { useDateFmt } from "@/lib/datefmt";
import { SortableTodoList } from "@/components/SortableTodoList";
import { TodoItem } from "@/components/TodoItem";
import { QuickAdd } from "@/components/QuickAdd";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import {
  Screen,
  HeaderBlock,
  Segmented,
  GroupHeader,
  List,
  Fab,
  SkeletonList,
} from "@/components/primitives";
import { SearchInput } from "@/components/SearchInput";
import { bare } from "@/lib/composer";
import { initials } from "@/lib/initials";
import type { Todo } from "@/lib/types";

type FilterMode = "contexts" | "today" | "starred" | "overdue" | "done";

function matchesTodo(todo: Todo, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    todo.description.toLowerCase().includes(needle) ||
    todo.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

/* "Today" and "overdue" are calendar-day questions, so they are answered in the
 * account's time zone rather than the browser's — otherwise an action shows as
 * overdue, or drops out of Today, purely because the machine sits in a
 * different zone from the account. `dayKey` yields a sortable YYYY-MM-DD in
 * that zone, so comparing the strings compares the days. */
type DayKey = (iso: string) => string;

function isDueToday(todo: Todo, dayKey: DayKey, today: string): boolean {
  return !!todo.due && dayKey(todo.due) <= today;
}

function isOverdue(todo: Todo, dayKey: DayKey, today: string): boolean {
  return !!todo.due && dayKey(todo.due) < today;
}

function completedToday(todos: Todo[] | undefined, dayKey: DayKey, today: string): number {
  if (!todos) return 0;
  return todos.filter((t) => t.completedAt && dayKey(t.completedAt) === today).length;
}

// HomePage is the GTD context view: every active context with its next actions.
export function HomePage() {
  const t = useT();
  const { user } = useAuth();
  const fmt = useDateFmt();
  // The account's today, as a sortable YYYY-MM-DD.
  const today = fmt.dayKey(new Date().toISOString());
  const { data: contexts, isLoading: loadingContexts } = useContexts();
  const { data: todos, isLoading: loadingTodos } = useTodos({ state: "active" });
  const { data: completed } = useTodos({ state: "completed" });

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("contexts");
  const [adding, setAdding] = useState(false);

  const activeContexts = contexts?.filter((c) => c.state === "active") ?? [];
  const byContext = new Map<number, Todo[]>();
  todos?.forEach((todo) => {
    if (!matchesTodo(todo, query)) return;
    const list = byContext.get(todo.contextId) ?? [];
    list.push(todo);
    byContext.set(todo.contextId, list);
  });

  const filtering = query.trim() !== "";
  const visibleContexts = filtering
    ? activeContexts.filter((c) => (byContext.get(c.id)?.length ?? 0) > 0)
    : activeContexts;

  // Today / Starred / Overdue read the active list; Done reads the completed
  // list. All are flat views where chips show @context, since no group header
  // names it.
  const source = filter === "done" ? completed ?? [] : todos ?? [];
  const flat = source
    .filter((todo) => matchesTodo(todo, query))
    .filter((todo) => {
      switch (filter) {
        case "today":
          return isDueToday(todo, fmt.dayKey, today);
        case "starred":
          return todo.starred;
        case "overdue":
          return isOverdue(todo, fmt.dayKey, today);
        default:
          return true;
      }
    });

  const openCount = todos?.length ?? 0;
  const doneToday = completedToday(completed, fmt.dayKey, today);
  const overdueCount = (todos ?? []).filter((todo) => isOverdue(todo, fmt.dayKey, today)).length;

  const loading = loadingContexts || loadingTodos;
  const emptyMessage =
    filter === "overdue"
      ? t("home.emptyOverdue")
      : filter === "done"
        ? t("home.emptyDone")
        : filter === "today"
          ? t("home.emptyToday")
          : t("home.emptyStarred");

  const header = (
    <HeaderBlock
      title={t("actions.title")}
      avatar={initials(user?.email)}
      metrics={[
        { value: openCount, label: t("home.openLabel") },
        { value: doneToday, label: t("home.doneTodayLabel"), tone: "done" },
        { label: `${activeContexts.length} ${t("home.contextsLabel")}` },
        { value: overdueCount, label: t("home.overdueLabel") },
      ]}
    />
  );

  return (
    <Screen
      header={header}
      fab={<Fab label={t("home.addAction")} onClick={() => setAdding(true)} />}
    >
      {/* Desktop create lives here, directly under the banner; mobile uses the FAB. */}
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <QuickAdd />
      </div>

      {/* Filter box first, the pills pushed to the right of the row. */}
      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("home.searchPlaceholder")}
          ariaLabel={t("home.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
        <Segmented
          className="ml-auto"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "contexts", label: t("nav.contexts") },
            { value: "today", label: t("home.filterToday") },
            { value: "starred", label: t("nav.starred") },
            { value: "overdue", label: t("home.filterOverdue") },
            { value: "done", label: t("nav.done") },
          ]}
        />
      </div>

      {loading ? (
        <SkeletonList />
      ) : filter === "contexts" ? (
        <>
          {filtering && visibleContexts.length === 0 && (
            <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("home.noMatch")}</p>
          )}
          <div className="flex flex-col gap-[15px] md:grid md:grid-cols-2 md:gap-5">
            {visibleContexts.map((c) => {
              const list = byContext.get(c.id) ?? [];
              return (
                <section key={c.id} className="flex flex-col gap-[9px]">
                  <GroupHeader label={`@${bare(c.name, "@")}`} count={list.length} />
                  {list.length === 0 ? (
                    <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
                      {t("home.noActionsHere")}
                    </p>
                  ) : filtering ? (
                    // Reordering is disabled on a filtered subset — a drop
                    // carries no meaningful position.
                    <List>
                      {list.map((todo) => (
                        <TodoItem key={todo.id} todo={todo} hideContext />
                      ))}
                    </List>
                  ) : (
                    <SortableTodoList todos={list} hideContext />
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : flat.length === 0 ? (
        <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{emptyMessage}</p>
      ) : (
        <List>
          {flat.map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </List>
      )}

      <QuickAddSheet open={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}
