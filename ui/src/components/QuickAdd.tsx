import { ActionForm } from "@/components/ActionForm";
import type { Sigil } from "@/lib/composer";

interface QuickAddProps {
  defaultContextId?: number;
  defaultProjectId?: number;
  /** Which prefixes this field accepts. A project page drops "#". */
  sigils?: Sigil[];
  /** Called after an action is added, so a container (the mobile sheet) can close. */
  onAdded?: () => void;
}

/**
 * Adding an action: the shared action form with no action to edit.
 *
 * Typing "@" completes a context, "#" a project and "!" a tag; all are stripped
 * from the description and applied to the action, and each also has its own
 * control on the form.
 */
export function QuickAdd({
  defaultContextId,
  defaultProjectId,
  sigils,
  onAdded,
}: QuickAddProps) {
  return (
    <ActionForm
      defaultContextId={defaultContextId}
      defaultProjectId={defaultProjectId}
      sigils={sigils}
      onDone={onAdded}
    />
  );
}
