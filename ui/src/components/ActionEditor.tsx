import { ActionForm } from "@/components/ActionForm";
import type { Todo } from "@/lib/types";

/**
 * Editing an action: the same form used to add one, given the action.
 *
 * Nothing is written until Save, and dismissing the editor another way — the
 * sheet's pull-down, the backdrop, Escape — discards the edit. Star and delete
 * are not here: on a phone they sit on the sheet's title row, and on the web
 * they are already on the row. Both act on the action rather than on a field.
 */
export function ActionEditor({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  return <ActionForm todo={todo} onDone={onClose} />;
}
