import { useState } from "react";
import { useT, type TFunc } from "@/lib/i18n";
import { useTodos } from "@/hooks/useTodos";
import { useTags } from "@/hooks/useProjects";
import { useContexts } from "@/hooks/useContexts";
import { useAllAttachments } from "@/hooks/useSettings";
import { TodoItem } from "@/components/TodoItem";
import { SearchInput } from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { nextTriState, type TriState } from "@/lib/adminFilter";
import { cn } from "@/lib/utils";
import type { Todo } from "@/lib/types";

/** Whether an action passes a yes/no/all switch on a boolean it has. */
function passesTri(value: boolean, state: TriState): boolean {
  return state === "all" ? true : state === "on" ? value : !value;
}

// TodoList renders a titled list of actions with a search box. `richFilters`
// adds yes/no/all switches for attachments and stars — used on the Done
// archive, where narrowing by "had files" or "was starred" is worth the space.
function TodoList({
  title,
  subtitle,
  filter,
  empty,
  richFilters = false,
}: {
  title: string;
  subtitle: string;
  filter: Parameters<typeof useTodos>[0];
  empty: string;
  richFilters?: boolean;
}) {
  const t = useT();
  const { data: todos, isLoading } = useTodos(filter);
  const { data: contexts } = useContexts();
  const { data: attachments } = useAllAttachments();
  const contextName = (id: number) => contexts?.find((c) => c.id === id)?.name;

  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<TriState>("all");
  const [starred, setStarred] = useState<TriState>("all");

  // Which actions have at least one attachment — one shared query, so this
  // costs nothing beyond what TodoItem already fetches.
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          className="sm:flex-1"
          value={query}
          onChange={setQuery}
          placeholder={t("list.searchPlaceholder")}
          ariaLabel={t("list.searchAria")}
        />
        {richFilters && (
          <div className="flex gap-2">
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

      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {todos && todos.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
      {todos && todos.length > 0 && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("list.noMatch")}</p>
      )}
      <ul className="space-y-2">
        {visible.map((todo) => (
          <TodoItem key={todo.id} todo={todo} showContext={contextName(todo.contextId)} />
        ))}
      </ul>
    </div>
  );
}

/** A yes/no/all filter button whose label reflects its current state. */
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
    <Button
      variant={state === "all" ? "outline" : "default"}
      size="sm"
      className="flex-1 sm:flex-none"
      onClick={onClick}
    >
      {t(labelKey, { state: t(`filter.${state}` as Parameters<TFunc>[0]) })}
    </Button>
  );
}

export function TicklerPage() {
  const t = useT();
  return (
    <TodoList
      title={t("tickler.title")}
      subtitle={t("tickler.subtitle")}
      filter={{ state: "deferred" }}
      empty={t("tickler.empty")}
    />
  );
}

export function StarredPage() {
  const t = useT();
  return (
    <TodoList
      title={t("starred.title")}
      subtitle={t("starred.subtitle")}
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
      subtitle={t("done.subtitle")}
      filter={{ state: "completed" }}
      empty={t("done.empty")}
      richFilters
    />
  );
}

export function TagsPage() {
  const t = useT();
  const { data: tags } = useTags();
  const [selected, setSelected] = useState<string | null>(null);
  const { data: todos } = useTodos(selected ? { tag: selected } : {});
  const { data: contexts } = useContexts();
  const contextName = (id: number) => contexts?.find((c) => c.id === id)?.name;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.tags")}</h1>
        <p className="text-sm text-muted-foreground">{t("tags.subtitle")}</p>
      </div>

      {tags?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("tags.emptyList")}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {tags?.map((t) => (
          <Button
            key={t.id}
            variant={selected === t.name ? "default" : "outline"}
            size="sm"
            onClick={() => setSelected(selected === t.name ? null : t.name)}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {selected && (
        <ul className={cn("space-y-2")}>
          {todos?.map((t) => (
            <TodoItem key={t.id} todo={t} showContext={contextName(t.contextId)} />
          ))}
          {todos?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("tags.emptyForTag")}</p>
          )}
        </ul>
      )}
    </div>
  );
}
