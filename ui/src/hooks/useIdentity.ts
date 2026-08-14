import { useMemo } from "react";
import { parseAction, type ParsedAction, type Sigil } from "@/lib/composer";
import { lastUsed } from "@/lib/lastUsed";
import type { Context, Project, Tag } from "@/lib/types";

/**
 * The half an action and a recurring pattern genuinely share: what it says,
 * which context it belongs to, which project it is part of.
 *
 * The rest is not shared and should not pretend to be — an action has two
 * dates, a pattern has a repeating rule, a window and a lead time from which it
 * derives an action's dates when it spawns one. Resolving the identity half in
 * one place and leaving the bottom halves apart is what keeps the reuse honest.
 */
export interface Identity {
  parsed: ParsedAction;
  /** The context this will be filed under, or undefined when a new one is named. */
  effectiveContextId: number | undefined;
  /** null is "no project" — a real choice, distinct from undefined. */
  effectiveProjectId: number | null;
  /**
   * A context/project named rather than chosen — typed as "@name" or made in
   * the picker. The server creates it when the form is saved, so it travels as
   * a name and there is no id to have yet.
   */
  newContextName: string | undefined;
  newProjectName: string | undefined;
  contextLabel: string | undefined;
  projectLabel: string | undefined;
}

/**
 * Resolves what the composer text and the pickers add up to.
 *
 * Precedence for the context: a typed "@token" wins, then the picker, then the
 * caller's own context, then whatever the last action used, then the first
 * context as a last resort — a context is mandatory, so there is always an
 * answer. The project has no such chain: an action or a pattern lives outside a
 * project unless one is named with "#", chosen here, or inherited from the page
 * it is being created on. Inheriting the last project used was a bug report,
 * not a feature.
 */
export function useIdentity({
  text,
  contexts,
  projects,
  knownTags = [],
  sigils,
  pickedContext,
  pickedProject,
  pickedContextName,
  pickedProjectName,
  defaultContextId,
  defaultProjectId,
}: {
  text: string;
  contexts: Context[];
  projects: Project[];
  knownTags?: Tag[];
  /** Empty turns the shortcuts off, which is how editing reads a stored description literally. */
  sigils: Sigil[];
  pickedContext?: number;
  pickedProject?: number | null;
  /** Named in the picker: "make me one called this", not yet created. */
  pickedContextName?: string;
  pickedProjectName?: string;
  defaultContextId?: number;
  defaultProjectId?: number;
}): Identity {
  const parseOpts = useMemo(() => ({ sigils }), [sigils]);
  const parsed = useMemo(
    () => parseAction(text, contexts, projects, knownTags, parseOpts),
    [text, contexts, projects, knownTags, parseOpts],
  );

  const remembered = contexts.some((c) => c.id === lastUsed.contextId)
    ? lastUsed.contextId
    : undefined;
  // A typed "@name" still wins: it is the more recent statement of intent, and
  // it is visible in the text while a picker's choice is not.
  const newContextName = parsed.contextIsNew ? parsed.contextName : pickedContextName;
  const newProjectName = parsed.projectIsNew ? parsed.projectName : pickedProjectName;

  const effectiveContextId = newContextName
    ? undefined
    : parsed.contextId ?? pickedContext ?? defaultContextId ?? remembered ?? contexts[0]?.id;
  const effectiveProjectId = newProjectName
    ? null
    : parsed.projectId ?? pickedProject ?? defaultProjectId ?? null;

  return {
    parsed,
    effectiveContextId,
    effectiveProjectId,
    newContextName,
    newProjectName,
    contextLabel: newContextName ?? contexts.find((c) => c.id === effectiveContextId)?.name,
    projectLabel: newProjectName ?? projects.find((p) => p.id === effectiveProjectId)?.name,
  };
}

