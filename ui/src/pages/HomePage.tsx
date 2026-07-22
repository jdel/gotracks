import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useContexts } from "@/hooks/useContexts";
import { useT } from "@/lib/i18n";
import { useTodos } from "@/hooks/useTodos";
import { SortableTodoList } from "@/components/SortableTodoList";
import { TodoItem } from "@/components/TodoItem";
import { QuickAdd } from "@/components/QuickAdd";
import { IconButton } from "@/components/ui/icon-button";
import { SearchInput } from "@/components/SearchInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FULLSCREEN_DIALOG_CLASS } from "@/components/PageWithAdd";
import { PageContainer } from "@/components/PageContainer";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "gt.collapsedContexts";

// loadCollapsed reads the set of collapsed context ids from the device, so the
// choice survives a reload rather than resetting on every visit.
function loadCollapsed(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

// matchesTodo tests an action against the filter text. Description and tags are
// searched — the two things written on the action itself — so "@" or "#" typed
// into the box match nothing special, they are just characters.
function matchesTodo(todo: Todo, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    todo.description.toLowerCase().includes(needle) ||
    todo.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

// HomePage is the GTD context view: every active context with its next actions.
export function HomePage() {
  const t = useT();
  const { data: contexts, isLoading: loadingContexts } = useContexts();
  const { data: todos, isLoading: loadingTodos } = useTodos({ state: "active" });

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(loadCollapsed);
  // The mobile quick-add lives behind a + in the header; on desktop the form is
  // always on screen, so this only ever opens the sheet on small viewports.
  const [adding, setAdding] = useState(false);

  function toggleCollapsed(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const activeContexts = contexts?.filter((c) => c.state === "active") ?? [];
  const byContext = new Map<number, Todo[]>();
  todos?.forEach((todo) => {
    if (!matchesTodo(todo, query)) return;
    const list = byContext.get(todo.contextId) ?? [];
    list.push(todo);
    byContext.set(todo.contextId, list);
  });

  const filtering = query.trim() !== "";
  // While filtering, only contexts that have a match are worth showing, and
  // collapse is ignored so results are never hidden behind a folded header.
  const visibleContexts = filtering
    ? activeContexts.filter((c) => (byContext.get(c.id)?.length ?? 0) > 0)
    : activeContexts;

  return (
    <PageContainer>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("actions.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("actions.subtitle")}</p>
        </div>
        {/* Quick add is a permanent form on desktop; on a phone it would take a
            row that could hold an action, so it hides behind this +. */}
        <IconButton
          variant="outline"
          className="shrink-0 md:hidden"
          label={t("home.addAction")}
          onClick={() => setAdding(true)}
        >
          <Plus />
        </IconButton>
      </div>

      <div className="hidden md:block">
        <QuickAdd />
      </div>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("home.searchPlaceholder")}
        ariaLabel={t("home.searchAria")}
      />

      {(loadingContexts || loadingTodos) && (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}

      {filtering && visibleContexts.length === 0 && !loadingTodos && (
        <p className="text-sm text-muted-foreground">{t("home.noMatch")}</p>
      )}

      <div className="space-y-6">
        {visibleContexts.map((c) => {
          const list = byContext.get(c.id) ?? [];
          const isCollapsed = collapsed.has(c.id) && !filtering;
          return (
            <section key={c.id}>
              <button
                type="button"
                onClick={() => toggleCollapsed(c.id)}
                aria-expanded={!isCollapsed}
                className="mb-2 flex w-full items-baseline gap-2 text-left text-sm font-semibold"
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 self-center text-muted-foreground transition-transform",
                    !isCollapsed && "rotate-90",
                  )}
                />
                {c.name}
                <span className="text-xs font-normal text-muted-foreground">{list.length}</span>
              </button>
              {!isCollapsed &&
                (list.length === 0 ? (
                  <p className="pl-6 text-sm text-muted-foreground">{t("home.noActionsHere")}</p>
                ) : filtering ? (
                  // Reordering is disabled on a filtered view: the list is a
                  // subset, so dropping one action carries no meaningful position.
                  <ul className="space-y-2">
                    {list.map((todo) => (
                      <TodoItem key={todo.id} todo={todo} />
                    ))}
                  </ul>
                ) : (
                  <SortableTodoList todos={list} />
                ))}
            </section>
          );
        })}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        {/* Full screen on a phone — an action-entry form with dates and tags
            wants the room; a centred card back on larger viewports. */}
        <DialogContent className={FULLSCREEN_DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>{t("home.addAction")}</DialogTitle>
          </DialogHeader>
          {/* Expanded by default here: the phone flow is a deliberate visit to
              add one action, so the extra fields are worth showing up front. */}
          <QuickAdd defaultExpanded onAdded={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
