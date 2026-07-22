import { useState } from "react";
import { CheckSquare, Plus, StickyNote, Trash2, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/SearchInput";
import { PageWithAdd } from "@/components/PageWithAdd";
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
  const { data: notes, isLoading } = useNotes();
  const { data: projects } = useProjects();
  const { data: contexts } = useContexts();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const createTodo = useCreateTodo();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
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
  const visibleNotes = (notes ?? []).filter((n) => n.body.toLowerCase().includes(needle));

  return (
    <PageWithAdd
      title={t("nav.notes")}
      subtitle={t("notes.subtitle")}
      addLabel={t("notes.addTitle")}
      renderForm={(onAdded) => <NoteAddForm projects={projectList} onAdded={onAdded} />}
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("notes.searchPlaceholder")}
        ariaLabel={t("notes.searchAria")}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      <ul className="space-y-2">
        {visibleNotes.map((n) => (
          <li key={n.id}>
            <Card className="space-y-2 p-3">
              {editingBody === n.id ? (
                <BodyEditor
                  note={n}
                  busy={updateNote.isPending}
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
                  className="w-full rounded text-left hover:bg-accent/40"
                >
                  <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
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
                  <IconButton
                    variant="ghost"
                    className="ml-auto size-7"
                    label={t("notes.turnIntoAction")}
                    onClick={() => setConverting(n)}
                  >
                    <CheckSquare className="size-3.5" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    className="size-7"
                    label={t("notes.delete")}
                    onClick={() => setConfirming(n.id)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </IconButton>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {notes?.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground">
          <StickyNote className="mr-1 inline size-4" />
          {t("notes.none")}
        </p>
      )}
      {notes && notes.length > 0 && visibleNotes.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("notes.noMatch")}</p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("notes.deleteTitle")}
        description={t("notes.deleteDesc")}
        busy={deleteNote.isPending}
        onConfirm={() => {
          if (confirming !== null) deleteNote.mutate(confirming);
          setConfirming(null);
        }}
      />

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
    </PageWithAdd>
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
  busy,
  onCancel,
  onSave,
}: {
  note: Note;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(note.body);
  const trimmed = text.trim();

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          // Enter alone inserts a newline — this is prose. Ctrl/Cmd+Enter
          // saves, matching the usual convention for a multi-line field.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmed) onSave(trimmed);
        }}
        aria-label={t("notes.noteText")}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!trimmed || busy} onClick={() => onSave(trimmed)}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("notes.saveHint")}</span>
      </div>
    </div>
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
        className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
      >
        <Plus className="size-3" /> {t("notes.projectChip")}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-violet-500/15 text-xs text-violet-700 dark:text-violet-300">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-l px-1.5 py-0.5 hover:bg-violet-500/20"
        title={t("notes.changeProject")}
      >
        #{bare(project.name, "#")}
      </button>
      <button
        type="button"
        onClick={onDetach}
        aria-label={t("notes.detachFrom", { name: project.name })}
        title={t("notes.detach")}
        className="rounded-r py-0.5 pr-1.5 hover:bg-violet-500/20"
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
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>
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
            <label className="mt-2 block text-sm font-normal">
              {t("notes.context")}
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
