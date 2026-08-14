import { X } from "lucide-react";
import { FilterPicker } from "@/components/FilterPicker";
import { IconButton } from "@/components/IconButton";
import { fieldLabel } from "@/components/primitive-styles";
import { bare } from "@/lib/composer";
import type { Identity } from "@/hooks/useIdentity";
import { useT } from "@/lib/i18n";
import type { Context, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The half an action and a recurring pattern genuinely share: what it says,
 * which context it belongs to, which project it is part of.
 *
 * The rest is not shared and should not pretend to be — an action has two
 * dates, a pattern has a repeating rule, a window and a lead time from which it
 * derives an action's dates when it spawns one. Extracting the identity half
 * and leaving the bottom halves apart is what keeps the reuse honest.
 */

/** Where this will land, as the shortcuts are typed. */
export function IdentityPills({
  identity,
  tags = [],
}: {
  identity: Identity;
  tags?: string[];
}) {
  const t = useT();
  const { parsed, contextLabel, projectLabel } = identity;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {contextLabel && (
        <span
          className={cn(
            "rounded-full px-2 py-[3px] text-[10px] font-bold text-brand dark:text-brand-ink-dark",
            parsed.contextIsNew
              ? "border border-dashed border-brand dark:border-brand-ink-dark"
              : "bg-brand-soft dark:bg-brand-pill-dark",
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
              : "bg-done-soft dark:bg-done-fill-dark",
          )}
        >
          #{bare(projectLabel, "#")}
          {parsed.projectIsNew && ` · ${t("quickadd.new")}`}
        </span>
      )}
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-line bg-surface px-2 py-[3px] text-[10px] font-bold text-ink-2 dark:border-line-dark dark:bg-card-dark dark:text-ink-2-dark"
        >
          !{tag}
        </span>
      ))}
    </div>
  );
}

/**
 * The value of the "not made yet" row. Not "" — that is already a real choice
 * on the project picker, where it means no project at all.
 */
const NEW = "__new";

const contextOptions = (contexts: Context[]) =>
  contexts.map((c) => ({ value: String(c.id), label: bare(c.name, "@") }));

const projectOptions = (projects: Project[], noProject: string) => [
  { value: "", label: noProject },
  ...projects.map((p) => ({ value: String(p.id), label: bare(p.name, "#") })),
];

/**
 * The context and project controls, typed into rather than scrolled through: a
 * native select is fine for four contexts and useless for forty.
 */
export function ContextProjectFields({
  identity,
  contexts,
  projects,
  onContextChange,
  onProjectChange,
  onContextCreate,
  onProjectCreate,
}: {
  identity: Identity;
  contexts: Context[];
  projects: Project[];
  onContextChange: (id: number | undefined) => void;
  onProjectChange: (id: number | null) => void;
  /** A name to make on save. The "@name" shorthand does the same thing. */
  onContextCreate: (name: string) => void;
  onProjectCreate: (name: string) => void;
}) {
  const t = useT();
  const { parsed, effectiveContextId, effectiveProjectId, newContextName, newProjectName } =
    identity;
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={fieldLabel}>
        {t("todo.context")}
        {/* A name that does not exist yet has no id to be its value, so it gets
            one of its own and stands at the top of the list as the current
            choice. The rest of the list stays reachable underneath it — a name
            staged here can be changed for one that exists. A name typed as
            "@token" is the exception: the text is in charge of that one, and a
            picker that appeared to override it would be lying, so it is shown
            alone. */}
        <FilterPicker
          className="mt-1"
          value={newContextName ? NEW : String(effectiveContextId ?? "")}
          options={
            newContextName
              ? [
                  { value: NEW, label: `@${newContextName}` },
                  ...(parsed.contextIsNew ? [] : contextOptions(contexts)),
                ]
              : contextOptions(contexts)
          }
          onChange={(v) => v !== NEW && onContextChange(v ? Number(v) : undefined)}
          onCreate={onContextCreate}
          createLabel={(name) => t("picker.create", { name })}
          ariaLabel={t("todo.context")}
          filterLabel={t("picker.filterContexts")}
          noMatchLabel={t("picker.noMatch")}
        />
      </label>

      <div className="flex items-end gap-2">
        <label className={`min-w-0 flex-1 ${fieldLabel}`}>
          {t("todo.project")}
          <FilterPicker
            className="mt-1"
            value={newProjectName ? NEW : String(effectiveProjectId ?? "")}
          options={
            newProjectName
              ? [
                  { value: NEW, label: `#${newProjectName}` },
                  ...(parsed.projectIsNew ? [] : projectOptions(projects, t("todo.noProject"))),
                ]
              : projectOptions(projects, t("todo.noProject"))
          }
          onChange={(v) => v !== NEW && onProjectChange(v ? Number(v) : null)}
          onCreate={onProjectCreate}
          createLabel={(name) => t("picker.create", { name })}
            ariaLabel={t("todo.project")}
            filterLabel={t("picker.filterProjects")}
            noMatchLabel={t("picker.noMatch")}
          />
        </label>
        {/* One tap out of a project. Choosing "No project" from the list is two,
            and the list has to be opened to find it.
            Not offered for a project named in the description: the text is what
            decides that one, so a button here would appear to do nothing. The
            description has a clear of its own. */}
        {!parsed.projectId && !parsed.projectIsNew && (effectiveProjectId !== null || newProjectName) && (
          <IconButton
            type="button"
            className="mb-0.5 size-8 shrink-0"
            label={t("todo.clearProject")}
            onClick={() => onProjectChange(null)}
          >
            <X className="size-3.5 text-ink-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
