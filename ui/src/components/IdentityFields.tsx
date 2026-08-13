import { FilterPicker } from "@/components/FilterPicker";
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
 * The context and project controls, typed into rather than scrolled through: a
 * native select is fine for four contexts and useless for forty.
 */
export function ContextProjectFields({
  identity,
  contexts,
  projects,
  onContextChange,
  onProjectChange,
}: {
  identity: Identity;
  contexts: Context[];
  projects: Project[];
  onContextChange: (id: number | undefined) => void;
  onProjectChange: (id: number | null) => void;
}) {
  const t = useT();
  const { parsed, effectiveContextId, effectiveProjectId } = identity;
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={fieldLabel}>
        {t("todo.context")}
        <FilterPicker
          className="mt-1"
          value={parsed.contextIsNew ? "" : String(effectiveContextId ?? "")}
          options={
            parsed.contextIsNew
              ? [{ value: "", label: `@${parsed.contextName}` }]
              : contexts.map((c) => ({ value: String(c.id), label: bare(c.name, "@") }))
          }
          onChange={(v) => onContextChange(v ? Number(v) : undefined)}
          ariaLabel={t("todo.context")}
          filterLabel={t("picker.filterContexts")}
          noMatchLabel={t("picker.noMatch")}
        />
      </label>

      <label className={fieldLabel}>
        {t("todo.project")}
        <FilterPicker
          className="mt-1"
          value={parsed.projectIsNew ? "" : String(effectiveProjectId ?? "")}
          options={[
            {
              value: "",
              label: parsed.projectIsNew ? `#${parsed.projectName}` : t("todo.noProject"),
            },
            ...projects.map((p) => ({ value: String(p.id), label: bare(p.name, "#") })),
          ]}
          onChange={(v) => onProjectChange(v ? Number(v) : null)}
          ariaLabel={t("todo.project")}
          filterLabel={t("picker.filterProjects")}
          noMatchLabel={t("picker.noMatch")}
        />
      </label>
    </div>
  );
}
