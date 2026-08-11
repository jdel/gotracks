import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Plus, ChevronDown } from "lucide-react";
import { useCreateTodo } from "@/hooks/useTodos";
import { useProjects, useTags } from "@/hooks/useProjects";
import { useContexts } from "@/hooks/useContexts";
import { ActionInput } from "@/components/ActionInput";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { bare, parseAction, ALL_SIGILS, type Sigil } from "@/lib/composer";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { lastUsed } from "@/lib/lastUsed";
import { cn } from "@/lib/utils";

interface QuickAddProps {
  defaultContextId?: number;
  defaultProjectId?: number;
  /** Which prefixes this field accepts. A project page drops "#". */
  sigils?: Sigil[];
  /** Called after an action is added, so a container (the mobile sheet) can close. */
  onAdded?: () => void;
  /** Start with the dates/tags panel open — used in the full-screen mobile add. */
  defaultExpanded?: boolean;
}

// QuickAdd is the Tracks-style single-line action entry. Typing "@" completes a
// context, "#" a project and "!" a tag; all are stripped from the description
// and applied to the action. An expandable panel covers dates and extra tags.
export function QuickAdd({
  defaultContextId,
  defaultProjectId,
  sigils = ALL_SIGILS,
  onAdded,
  defaultExpanded = false,
}: QuickAddProps) {
  const t = useT();
  const fmt = useDateFmt();
  const create = useCreateTodo();
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects("active");
  const { data: knownTags } = useTags();

  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [due, setDue] = useState("");
  const [showFrom, setShowFrom] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  // Show-from of the action just created, when the server deferred it. Cleared
  // on the next submit, so the notice always refers to the latest action.
  const [deferredUntil, setDeferredUntil] = useState("");

  const activeContexts = useMemo(
    () => contexts?.filter((c) => c.state === "active") ?? [],
    [contexts]
  );
  const activeProjects = useMemo(() => projects ?? [], [projects]);
  const tagList = useMemo(() => knownTags ?? [], [knownTags]);
  const parseOpts = useMemo(() => ({ sigils }), [sigils]);

  const parsed = useMemo(
    () => parseAction(text, activeContexts, activeProjects, tagList, parseOpts),
    [text, activeContexts, activeProjects, tagList, parseOpts]
  );

  // Precedence: a typed token wins, then the page's own context/project, then
  // whatever the previous action used, then the first context as a last resort.
  // A token naming something new carries no id — the server creates it by name.
  const rememberedContext = activeContexts.some((c) => c.id === lastUsed.contextId)
    ? lastUsed.contextId
    : undefined;
  const rememberedProject = activeProjects.some((p) => p.id === lastUsed.projectId)
    ? lastUsed.projectId
    : undefined;

  const effectiveContextId = parsed.contextIsNew
    ? undefined
    : parsed.contextId ?? defaultContextId ?? rememberedContext ?? activeContexts[0]?.id;
  const effectiveProjectId = parsed.projectIsNew
    ? undefined
    : parsed.projectId ?? defaultProjectId ?? rememberedProject;

  const contextLabel =
    parsed.contextName ?? activeContexts.find((c) => c.id === effectiveContextId)?.name;
  const projectLabel =
    parsed.projectName ?? activeProjects.find((p) => p.id === effectiveProjectId)?.name;

  // Tags typed as "!tag" plus any from the expanded field, de-duplicated.
  const allTags = useMemo(() => {
    const manual = tags.split(",").map((t) => t.trim()).filter(Boolean);
    return Array.from(new Set([...parsed.tags, ...manual].map((t) => t.toLowerCase())));
  }, [parsed.tags, tags]);

  const placeholder = sigils.includes("#")
    ? t("quickadd.placeholderFull")
    : t("quickadd.placeholderNoProject");

  function submit() {
    if (!parsed.description) return;
    // A new @name substitutes for an existing context, so only complain when
    // there is neither.
    if (!effectiveContextId && !parsed.contextIsNew) {
      setError(t("quickadd.errorContext"));
      return;
    }
    setError("");
    create.mutate(
      {
        contextId: effectiveContextId,
        projectId: effectiveProjectId,
        contextName: parsed.contextIsNew ? parsed.contextName : undefined,
        projectName: parsed.projectIsNew ? parsed.projectName : undefined,
        description: parsed.description,
        due: due || undefined,
        showFrom: showFrom || undefined,
        tags: allTags.length > 0 ? allTags : undefined,
      },
      {
        onSuccess: (todo) => {
          // Remember where it landed, including a context the server just created.
          lastUsed.remember(todo.contextId, todo.projectId);
          // The server owns the decision — it applies the user's default
          // show-from — so the state it returns is what decides the notice.
          setDeferredUntil(todo.state === "deferred" && todo.showFrom ? todo.showFrom : "");
          setText("");
          setDue("");
          setShowFrom("");
          setTags("");
          onAdded?.();
        },
        onError: (err) => setError(apiMessage(err, t("quickadd.errorAdd"))),
      }
    );
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  return (
    <form onSubmit={onFormSubmit} className="space-y-2">
      <div className="flex gap-2">
        <ActionInput
          value={text}
          onChange={setText}
          onSubmit={submit}
          contexts={activeContexts}
          projects={activeProjects}
          tags={tagList}
          sigils={sigils}
          placeholder={placeholder}
        />
        <IconButton
          type="button"
          variant="outline"
          label={expanded ? t("quickadd.collapse") : t("quickadd.expand")}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
        </IconButton>
        <Button type="submit" disabled={create.isPending}>
          <Plus /> <span className="hidden sm:inline">{t("common.add")}</span>
        </Button>
      </div>

      {/* Live preview of where this action will land. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {contextLabel && (
          <span
            className={cn(
              "rounded-full px-2 py-[3px] text-[10px] font-bold text-brand dark:text-brand-ink-dark",
              parsed.contextIsNew
                ? "border border-dashed border-brand dark:border-brand-ink-dark"
                : "bg-brand-soft dark:bg-brand-pill-dark"
            )}
          >
            @{bare(contextLabel, "@")}
            {parsed.contextIsNew && ` · ${t("quickadd.new")}`}
          </span>
        )}
        {projectLabel && (
          <span
            className={cn(
              "rounded-full px-2 py-[3px] text-[10px] font-bold text-done-text dark:text-done-dark",
              parsed.projectIsNew
                ? "border border-dashed border-done dark:border-done-dark"
                : "bg-done-soft dark:bg-done-fill-dark"
            )}
          >
            #{bare(projectLabel, "#")}
            {parsed.projectIsNew && ` · ${t("quickadd.new")}`}
          </span>
        )}
        {allTags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-line bg-surface px-2 py-[3px] text-[10px] font-bold text-ink-2 dark:border-line-dark dark:bg-card-dark dark:text-ink-2-dark"
          >
            !{tag}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            {t("quickadd.due")}
            <Input type="date" className="mt-1" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("quickadd.showFrom")}
            <Input
              type="date"
              className="mt-1"
              value={showFrom}
              onChange={(e) => setShowFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {t("quickadd.tags")}
            <Input
              className="mt-1"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("quickadd.tagsPlaceholder")}
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* An action created with a due date can be deferred on the spot, and
          then it is not in the list the user is looking at. Say where it went
          rather than letting it appear to have vanished. */}
      {deferredUntil && (
        <p className="text-sm font-medium text-ink-2 dark:text-ink-2-dark">
          {t("quickadd.deferred", { date: fmt.day(deferredUntil) })}{" "}
          <Link to="/tickler" className="text-brand underline dark:text-brand-ink-dark">
            {t("quickadd.deferredLink")}
          </Link>
        </p>
      )}
    </form>
  );
}
