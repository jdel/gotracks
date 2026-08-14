import { useRef, useState } from "react";
import { CheckSquare, Plus, Trash2, X } from "lucide-react";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useProjects,
  useUpdateNote,
} from "@/hooks/useProjects";
import { useContexts } from "@/hooks/useContexts";
import { useCreateTodo } from "@/hooks/useTodos";
import { ActionInput } from "@/components/ActionInput";
import { bare, parseAction } from "@/lib/composer";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/IconButton";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Button, EmptyState, Fab, HeaderBlock, Screen, Sheet, SkeletonList } from "@/components/primitives";
import { rowActions, inlineEdit } from "@/components/primitive-styles";
import { useUndo } from "@/lib/undo";
import { cn } from "@/lib/utils";
import type { Note, Project } from "@/lib/types";

/** The add-note field. Only "#project" is recognised — a note has no context —
 *  and onAdded closes the mobile add sheet after a success. */
function NoteAddForm({ projects, onAdded }: { projects: Project[]; onAdded: () => void }) {
  const t = useT();
  const createNote = useCreateNote();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  function onAdd() {
    const trimmed = body.trim();
    if (!trimmed) return;
    const parsed = parseAction(trimmed, [], projects, [], { sigils: ["#"] });
    if (!parsed.description) return;
    setError("");
    createNote.mutate(
      {
        body: parsed.description,
        projectId: parsed.projectIsNew ? undefined : parsed.projectId,
        projectName: parsed.projectIsNew ? parsed.projectName : undefined,
      },
      {
        onSuccess: () => {
          setBody("");
          onAdded();
        },
        onError: (err) => setError(apiMessage(err, t("notes.errorAdd"))),
      },
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd();
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <ActionInput
          value={body}
          onChange={setBody}
          onSubmit={onAdd}
          contexts={[]}
          projects={projects}
          tags={[]}
          sigils={["#"]}
          placeholder={t("notes.addPlaceholder")}
        />
        <Button type="submit" disabled={createNote.isPending}>
          {t("common.add")}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function NotesPage() {
  const t = useT();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const { data: notes, isLoading } = useNotes();
  const { data: projects } = useProjects();
  const { data: contexts } = useContexts();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const createTodo = useCreateTodo();
  const [query, setQuery] = useState("");
  const { pendingKey, schedule } = useUndo();
  const [converting, setConverting] = useState<Note | null>(null);
  /** Surfaces whatever the server refused, quota messages included. */
  const [error, setError] = useState("");
  /** Which note's project is being edited inline, if any. */
  const [editingProject, setEditingProject] = useState<number | null>(null);
  /** Which note's text is being edited inline, if any. */
  const [editingBody, setEditingBody] = useState<number | null>(null);

  const projectList = projects ?? [];
  const projectOf = (id?: number) => projectList.find((p) => p.id === id);

  // A context is mandatory for an action but a note has none, so turning one
  // into the other needs to ask which context it lands in. The project, if
  // any, carries over unchanged; the note is removed once the action exists,
  // since it now represents a decision made, not reference material anymore.
  function onConvert(note: Note, contextId: number) {
    setError("");
    createTodo.mutate(
      { contextId, description: note.body, projectId: note.projectId },
      {
        onSuccess: () => {
          deleteNote.mutate(note.id);
          setConverting(null);
        },
        onError: (err) =>
          setError(apiMessage(err, t("notes.errorConvert"))),
      },
    );
  }

  const needle = query.trim().toLowerCase();
  // A note pending deletion is out of the list at once; the toast's Undo puts it
  // back, and only the toast expiring makes the delete real.
  const visibleNotes = (notes ?? []).filter(
    (n) => n.body.toLowerCase().includes(needle) && pendingKey !== `note:${n.id}`,
  );

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("nav.notes")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
          metrics={[{ value: notes?.length ?? 0, label: t("notes.metricLabel") }]}
        />
      }
      fab={<Fab label={t("notes.addTitle")} onClick={() => setAdding(true)} />}
    >
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <NoteAddForm projects={projectList} onAdded={() => {}} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("notes.searchPlaceholder")}
          ariaLabel={t("notes.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
      </div>

      {error && <p className="pb-3 text-sm font-medium text-danger">{error}</p>}

      {isLoading ? (
        <SkeletonList />
      ) : notes?.length === 0 ? (
        <EmptyState message={t("notes.none")} />
      ) : visibleNotes.length === 0 ? (
        <EmptyState message={t("notes.noMatch")} />
      ) : (
      <ul className="flex flex-col gap-[9px] md:grid md:grid-cols-3 md:gap-3 md:[align-content:start]">
        {visibleNotes.map((n) => (
          <li key={n.id}>
            <div className="group relative space-y-2 rounded-card bg-card p-3.5 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
              {editingBody === n.id ? (
                <BodyEditor
                  note={n}
                  onCancel={() => setEditingBody(null)}
                  onSave={(body) => {
                    // Only the text: the project belongs to the chip, so "#"
                    // in prose such as "see issue #42" stays prose.
                    updateNote.mutate({ id: n.id, body });
                    setEditingBody(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingBody(n.id)}
                  title={t("notes.editTitle")}
                  className="w-full rounded text-left"
                >
                  <p className="line-clamp-3 text-sm font-medium break-words whitespace-pre-wrap text-ink dark:text-ink-dark">
                    {n.body}
                  </p>
                </button>
              )}
              {/* Editing takes the whole row: the field needs the width, and
                  the other actions would only be in the way mid-edit. */}
              {editingProject === n.id ? (
                <ProjectEditor
                  note={n}
                  projects={projectList}
                  onCancel={() => setEditingProject(null)}
                  onApply={(input) => {
                    updateNote.mutate({ id: n.id, ...input });
                    setEditingProject(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <ProjectChip
                    project={projectOf(n.projectId)}
                    onEdit={() => setEditingProject(n.id)}
                    onDetach={() => updateNote.mutate({ id: n.id, clearProject: true })}
                  />
                  <div className={cn(rowActions, "ml-auto")}>
                    <IconButton
                      className="size-7"
                      label={t("notes.turnIntoAction")}
                      onClick={() => setConverting(n)}
                    >
                      <CheckSquare className="size-3.5" />
                    </IconButton>
                    <IconButton
                      className="size-7"
                      label={t("notes.delete")}
                      onClick={() =>
                        schedule(`note:${n.id}`, t("notes.deleted"), () => deleteNote.mutate(n.id))
                      }
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </IconButton>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("notes.addTitle")}>
        <NoteAddForm projects={projectList} onAdded={() => setAdding(false)} />
      </Sheet>

      <ConvertDialog
        // Remounts per note so its context selection starts fresh each time,
        // rather than reusing state from a previous note or an earlier
        // render before the context list had loaded.
        key={converting?.id ?? "none"}
        note={converting}
        contexts={contexts ?? []}
        busy={createTodo.isPending || deleteNote.isPending}
        onCancel={() => setConverting(null)}
        onConvert={onConvert}
      />
    </Screen>
  );
}

/**
 * Inline text editor for a note.
 *
 * Deliberately a plain textarea with no token parsing: a note is prose, and
 * scanning it for "#" would turn "see issue #42" into a project named 42 and
 * eat the text. Notes are also multi-line, unlike an action's title, so this
 * is a textarea rather than the single-line composer field. The project is
 * changed from its chip instead.
 */
function BodyEditor({
  note,
  onCancel,
  onSave,
}: {
  note: Note;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(note.body);
  // Enter inserts a newline (prose). Clicking away saves; Escape abandons. No
  // buttons — same inline-edit behaviour as an action, minus Enter-to-save,
  // which a multi-line field can't use.
  const finished = useRef(false);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    const trimmed = text.trim();
    if (save && trimmed && trimmed !== note.body) onSave(trimmed);
    else onCancel();
  }

  return (
    <textarea
      autoFocus
      rows={Math.min(8, Math.max(2, text.split("\n").length))}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      aria-label={t("notes.noteText")}
      className={cn(
        inlineEdit,
        "resize-none text-base leading-relaxed font-medium text-ink md:text-sm dark:text-ink-dark",
      )}
    />
  );
}

/**
 * The note's project, shown the way an action shows one: a "#project" chip in
 * the same violet as everywhere else. Clicking it edits, the × detaches — so
 * the two operations are where the thing they act on already is, rather than
 * in a permanent dropdown the row does not otherwise need.
 */
function ProjectChip({
  project,
  onEdit,
  onDetach,
}: {
  project?: Project;
  onEdit: () => void;
  onDetach: () => void;
}) {
  const t = useT();
  if (!project) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-[3px] text-[10px] font-bold text-ink-4 hover:border-solid hover:text-ink-2 dark:border-line-dark"
      >
        <Plus className="size-3" /> {t("notes.projectChip")}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-done-soft text-[10px] font-bold text-done-text dark:bg-done-fill-dark dark:text-done-dark">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-l-full py-[3px] pr-1 pl-2"
        title={t("notes.changeProject")}
      >
        #{bare(project.name, "#")}
      </button>
      <button
        type="button"
        onClick={onDetach}
        aria-label={t("notes.detachFrom", { name: project.name })}
        title={t("notes.detach")}
        className="rounded-r-full py-[3px] pr-2 pl-0.5"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * Inline project picker: the same autocomplete field the composer uses, scoped
 * to "#". Reusing it means one syntax, one keyboard behaviour and the same
 * create-a-new-project row, instead of a second vocabulary for the same idea.
 *
 * It edits only the project. The note body is prose, and re-parsing it for "#"
 * would silently turn "see issue #42" into a project named 42.
 */
function ProjectEditor({
  note,
  projects,
  onCancel,
  onApply,
}: {
  note: Note;
  projects: Project[];
  onCancel: () => void;
  onApply: (input: { projectId?: number; projectName?: string; clearProject?: boolean }) => void;
}) {
  const t = useT();
  const current = projects.find((p) => p.id === note.projectId);
  const [text, setText] = useState(current ? `#${bare(current.name, "#")} ` : "#");

  function apply() {
    const parsed = parseAction(text, [], projects, [], { sigils: ["#"] });
    // An emptied field means "no project": the only way to say that here, and
    // the same outcome as the chip's ×.
    if (!parsed.projectName) {
      onApply({ clearProject: true });
      return;
    }
    if (parsed.projectIsNew) {
      onApply({ projectName: parsed.projectName });
      return;
    }
    onApply({ projectId: parsed.projectId });
  }

  return (
    <div className="flex w-full items-center gap-2" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <ActionInput
        value={text}
        onChange={setText}
        onSubmit={apply}
        contexts={[]}
        projects={projects}
        tags={[]}
        sigils={["#"]}
        placeholder={t("notes.projectPlaceholder")}
        // Opened by a click on the chip; typing should not need a second one.
        autoFocus
      />
      <Button type="button" size="sm" onClick={apply}>
        {t("common.apply")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}

/** Asks which context the new action lands in — the one thing a note has no
 *  equivalent of, so it cannot be filled in silently. */
function ConvertDialog({
  note,
  contexts,
  busy,
  onCancel,
  onConvert,
}: {
  note: Note | null;
  contexts: { id: number; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onConvert: (note: Note, contextId: number) => void;
}) {
  const t = useT();
  const [contextId, setContextId] = useState<number | "">(contexts[0]?.id ?? "");

  return (
    <ConfirmDialog
      open={note !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={t("notes.convertTitle")}
      description={
        contexts.length === 0 ? (
          <>{t("notes.convertNeedContext")}</>
        ) : (
          <>
            {t("notes.convertDesc")}
            <label className="mt-2 block text-sm font-medium">
              {t("notes.context")}
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-base md:text-sm"
                value={contextId}
                onChange={(e) => setContextId(Number(e.target.value))}
              >
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )
      }
      confirmLabel={t("notes.convert")}
      busy={busy}
      onConfirm={() => {
        if (note && contextId !== "") onConvert(note, contextId);
      }}
    />
  );
}
