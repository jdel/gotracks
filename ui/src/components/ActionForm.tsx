import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { ChevronDown, X } from "lucide-react";
import { ActionInput } from "@/components/ActionInput";
import { DateFields } from "@/components/DateFields";
import { ContextProjectFields, IdentityPills } from "@/components/IdentityFields";
import { fieldLabel } from "@/components/primitive-styles";
import { useIdentity } from "@/hooks/useIdentity";
import { Button, Input } from "@/components/primitives";
import { IconButton } from "@/components/IconButton";
import { useContexts } from "@/hooks/useContexts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useProjects, useTags } from "@/hooks/useProjects";
import { useCreateTodo, useUpdateTodo, type TodoInput } from "@/hooks/useTodos";
import { apiMessage } from "@/lib/api";
import { dayValue } from "@/lib/actionDates";
import { ALL_SIGILS, type Sigil } from "@/lib/composer";
import { useDateFmt } from "@/lib/datefmt";
import { useT } from "@/lib/i18n";
import { useFocusFirstField } from "@/hooks/useFocusFirstField";
import { lastUsed } from "@/lib/lastUsed";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

function tagList(tags: string): string[] {
  return tags
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ActionFormProps {
  /** The action being edited. Omitted to create a new one. */
  todo?: Todo;
  defaultContextId?: number;
  defaultProjectId?: number;
  /** Which prefixes the description accepts when creating. A project page drops "#". */
  sigils?: Sigil[];
  /**
   * One line and a button, for the desktop capture bar: type, press Enter, keep
   * reading the list. The fields below are what the mobile sheet is for, and
   * what "@", "#" and "!" already reach from the line itself.
   */
  compact?: boolean;
  /** Creating: after the action is added. Editing: after Save, or on cancel. */
  onDone?: () => void;
}

/**
 * One form for adding an action and for editing one.
 *
 * They were separate for a long time and drifted — different layouts, different
 * fields, two places to fix anything about either. The only real difference is
 * how the description is read: creating accepts "@context", "#project" and
 * "!tag" as shortcuts that fill in the controls below, while editing takes the
 * description literally. Re-parsing a stored description would be destructive —
 * "call about invoice #7741" would acquire a project named 7741 the first time
 * anyone touched an unrelated field — so editing turns the sigils off, which
 * the same input already supports.
 *
 * Everything else is shared: the context and project controls, the tags, the
 * two dates and their quick-sets, and the single Save.
 */
export function ActionForm({
  todo,
  defaultContextId,
  defaultProjectId,
  sigils = ALL_SIGILS,
  compact = false,
  onDone,
}: ActionFormProps) {
  const t = useT();
  const fmt = useDateFmt();
  const isDesktop = useIsDesktop();
  const uid = useId();
  const fields = useRef<HTMLDivElement>(null);
  const create = useCreateTodo();
  const update = useUpdateTodo();
  const editing = todo !== undefined;

  const { data: contexts } = useContexts();
  const { data: projects } = useProjects(editing ? undefined : "active");
  const { data: knownTags } = useTags();

  const [text, setText] = useState(todo?.description ?? "");
  // The context and project chosen in the selects. Creating starts them unset,
  // so the defaults below still apply until the user picks something.
  const [pickedContext, setPickedContext] = useState<number | undefined>(todo?.contextId);
  const [pickedProject, setPickedProject] = useState<number | null | undefined>(
    editing ? todo.projectId ?? null : undefined,
  );
  // Named in a picker rather than chosen from it. Held as a name because there
  // is nothing to hold an id of yet: the server makes it when this is saved.
  const [newContext, setNewContext] = useState<string>();
  const [newProject, setNewProject] = useState<string>();
  // Adding leaves the form open for the next action, so the caret goes back
  // where the typing starts rather than staying on the button that was pressed.
  const description = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(todo ? todo.tags.join(", ") : "");
  const [dates, setDates] = useState({
    due: dayValue(todo?.due, fmt.dayKey),
    showFrom: dayValue(todo?.showFrom, fmt.dayKey),
  });
  const [error, setError] = useState("");
  // Compact only: the one-line bar can open into the same fields the sheet
  // shows, for the times when the "@"/"#"/"!" shortcuts are not enough — a due
  // date has no shorthand.
  const [expanded, setExpanded] = useState(false);
  // Show-from of the action just created, when the server deferred it. Cleared
  // on the next submit, so the notice always refers to the latest action.
  const [deferredUntil, setDeferredUntil] = useState("");

  const activeContexts = useMemo(
    () => contexts?.filter((c) => c.state === "active") ?? [],
    [contexts],
  );
  const activeProjects = useMemo(() => projects ?? [], [projects]);
  const knownTagList = useMemo(() => knownTags ?? [], [knownTags]);
  // Editing takes the description literally; creating reads the shortcuts.
  const identity = useIdentity({
    text,
    contexts: activeContexts,
    projects: activeProjects,
    knownTags: knownTagList,
    sigils: editing ? [] : sigils,
    pickedContext,
    pickedProject,
    pickedContextName: newContext,
    pickedProjectName: newProject,
    defaultContextId,
    defaultProjectId,
  });
  const { parsed, effectiveContextId, effectiveProjectId } = identity;

  // Tags typed as "!tag" plus any from the tags field, de-duplicated.
  const allTags = useMemo(
    () => Array.from(new Set([...parsed.tags, ...tagList(tags)].map((s) => s.toLowerCase()))),
    [parsed.tags, tags],
  );

  /** What an edit would send: only the fields that actually moved. */
  function changes(): TodoInput {
    if (!todo) return {};
    const out: TodoInput = {};
    const description = parsed.description.trim();
    if (description && description !== todo.description) out.description = description;
    if (effectiveContextId && effectiveContextId !== todo.contextId) {
      out.contextId = effectiveContextId;
    }
    // Naming one while editing works exactly as it does while adding: the
    // server creates it and files the action under it in the same request.
    if (identity.newContextName) out.contextName = identity.newContextName;
    if (identity.newProjectName) out.projectName = identity.newProjectName;
    if (effectiveProjectId !== (todo.projectId ?? null)) {
      out.projectId = effectiveProjectId ?? undefined;
      // Taking an action out of a project has to be said out loud: a missing
      // projectId is also what "leave unchanged" looks like on the wire, so
      // sending null alone left the action where it was.
      //
      // Not while a new project is named, though: it has no id yet, so it also
      // reads as null here — and the server drops the name when clearProject
      // is set, which would file the action nowhere instead of in the project
      // it was just told to make.
      if (effectiveProjectId === null && !identity.newProjectName) out.clearProject = true;
    }
    if (allTags.join(",") !== [...todo.tags].map((s) => s.toLowerCase()).join(",")) {
      out.tags = allTags;
    }
    // An empty string clears a date, so only a field that moved is sent —
    // otherwise saving one date would wipe the other.
    if (dates.due !== dayValue(todo.due, fmt.dayKey)) out.due = dates.due;
    if (dates.showFrom !== dayValue(todo.showFrom, fmt.dayKey)) out.showFrom = dates.showFrom;
    return out;
  }

  const dirty = editing && Object.keys(changes()).length > 0;

  function submit() {
    if (!parsed.description.trim()) return;
    // Inside the gesture, not only in the success handler: iOS opens the
    // keyboard for a focus() made while a user gesture is being handled, and
    // by the time the action exists the gesture is long over — so the caret
    // arrived back in the field with the keyboard left down.
    //
    // Deliberately *not* done by stopping Save from taking focus in the first
    // place: the date fields commit their value on blur, so a Save that never
    // blurs them creates the action without the date that was just typed.
    if (!editing) description.current?.focus();
    // A named context substitutes for an existing one, whether it was typed
    // as "@name" or made in the picker, so only complain when there is neither.
    if (!effectiveContextId && !identity.newContextName) {
      setError(t("quickadd.errorContext"));
      return;
    }
    setError("");

    if (todo) {
      if (dirty) update.mutate({ id: todo.id, ...changes() });
      onDone?.();
      return;
    }

    create.mutate(
      {
        contextId: effectiveContextId,
        projectId: effectiveProjectId ?? undefined,
        contextName: identity.newContextName,
        projectName: identity.newProjectName,
        description: parsed.description,
        due: dates.due || undefined,
        showFrom: dates.showFrom || undefined,
        tags: allTags.length > 0 ? allTags : undefined,
      },
      {
        onSuccess: (created) => {
          // Remember the context it landed in, including one the server just
          // created. Not the project — see lastUsed.
          lastUsed.remember(created.contextId);
          // The server owns the decision — it applies the user's default
          // show-from — so the state it returns is what decides the notice.
          setDeferredUntil(created.state === "deferred" && created.showFrom ? created.showFrom : "");
          setText("");
          setNewContext(undefined);
          setNewProject(undefined);
          setDates({ due: "", showFrom: "" });
          description.current?.focus();
          setTags("");
          setPickedProject(undefined);
          onDone?.();
        },
        onError: (err) => setError(apiMessage(err, t("quickadd.errorAdd"))),
      },
    );
  }

  // The inline desktop panel only. Adding mounts with the page, and stealing
  // the caret there would put the cursor in a form nobody asked for; on a phone
  // the sheet focuses its own first field, and this was racing it and winning —
  // landing on the context picker rather than the description above it.
  useFocusFirstField(fields, editing && isDesktop);

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    // Editing still has one explicit exit: Save. Keeping the editor inside a
    // real form gives iOS the complete previous/next field group without
    // letting an implicit browser submit dismiss it.
    if (!editing) submit();
  }

  const placeholder = sigils.includes("#")
    ? t("quickadd.placeholderFull")
    : t("quickadd.placeholderNoProject");

  // Ctrl/Cmd+Enter deliberately saves from any field; Escape leaves without
  // saving, which is what dismissing the screen already does on a phone.
  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editing) {
      e.preventDefault();
      onDone?.();
    }
  }

  return (
    <form className="space-y-2" onSubmit={onFormSubmit} onKeyDown={onPanelKeyDown}>
      {/* Always while adding; while editing, only on a phone. A desktop edits
          the description by clicking the title in the row, where the result
          reads exactly as it will afterwards — a second field there would be
          two ways to change one thing. A phone has no such second way: the
          editor is where it goes, or the words cannot be changed from the
          panel that holds every other field. Nothing is re-parsed either way
          — editing passes no sigils, so "invoice #7741" stays a description. */}
      {(!editing || !isDesktop) && (
        <div className={cn("flex gap-2", !compact && "items-center")}>
          <ActionInput
            value={text}
            onChange={setText}
            onSubmit={submit}
            contexts={activeContexts}
            projects={activeProjects}
            tags={knownTagList}
            sigils={sigils}
            inputRef={description}
            // The field names itself: "Add an action" is wrong on a panel that
            // is changing one that exists.
            placeholder={editing ? t("todo.actionDescription") : placeholder}
          />
          {/* One tap to empty it. Selecting a line of text on a phone to delete
              it is four gestures and a magnifying glass. */}
          {text && (
            <IconButton
              type="button"
              className="size-8 shrink-0"
              label={t("quickadd.clearText")}
              onClick={() => {
                setText("");
                description.current?.focus();
              }}
            >
              <X className="size-3.5 text-ink-4" />
            </IconButton>
          )}
          {compact && (
            <IconButton
              type="button"
              label={expanded ? t("quickadd.collapse") : t("quickadd.expand")}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </IconButton>
          )}
          {compact && (
            <Button
              type="submit"
              disabled={create.isPending}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              title={t("common.saveShortcut")}>
              {t("common.save")}
            </Button>
          )}
        </div>
      )}

      {/* Where this action will land. Only worth showing while the shortcuts
          are live — editing has the controls below and nothing to preview. */}
      {!editing && <IdentityPills identity={identity} tags={allTags} />}

      {(!compact || expanded) && (
      <div className="grid gap-3" ref={fields}>
        <ContextProjectFields
          identity={identity}
          contexts={activeContexts}
          projects={activeProjects}
          // Choosing one that exists and naming a new one are the same
          // decision, so each clears the other.
          onContextChange={(id) => {
            setPickedContext(id);
            setNewContext(undefined);
          }}
          onProjectChange={(id) => {
            setPickedProject(id);
            setNewProject(undefined);
          }}
          onContextCreate={(name) => {
            setNewContext(name);
            setPickedContext(undefined);
          }}
          onProjectCreate={(name) => {
            setNewProject(name);
            setPickedProject(undefined);
          }}
        />

        <div className="flex items-end gap-2">
          <label className={`min-w-0 flex-1 ${fieldLabel}`}>
            {t("quickadd.tags")}
            <Input
              className="mt-1"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("quickadd.tagsPlaceholder")}
            />
          </label>
          {tags && (
            <IconButton
              type="button"
              className="mb-0.5 size-8 shrink-0"
              label={t("quickadd.clearTags")}
              onClick={() => setTags("")}
            >
              <X className="size-3.5 text-ink-4" />
            </IconButton>
          )}
        </div>

        {/* Last, deliberately. iOS moves between fields with the arrows above
            its keyboard, and landing on a date input opens the wheel. Keeping
            dates at the end avoids opening it merely on the way to another
            text field. Leaving Show from blank is what lets the server apply
            the user's default when a due date is set. */}
        <DateFields value={dates} onChange={setDates} idPrefix={uid} />
      </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!compact && (
      <div className="flex items-center gap-2">
        {editing && dirty && (
          <span className="text-xs font-medium text-ink-4 dark:text-ink-4-dark">
            {t("todo.unsaved")}
          </span>
        )}
        <Button
          type={editing ? "button" : "submit"}
          onClick={editing ? submit : undefined}
          className="ml-auto"
          disabled={create.isPending || (editing && !dirty)}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          title={t("common.saveShortcut")}>
          {t("common.save")}
        </Button>
      </div>
      )}

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
