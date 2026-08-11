import { useRef, useState, type FocusEvent } from "react";
import { DateFields, type ActionDates } from "@/components/DateFields";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/**
 * The date pair as an edit with a beginning and an end, for the places that
 * write to the server.
 *
 * Nothing is saved as you touch it. Picking "next week" for Due is usually the
 * first half of a thought whose second half is Show from, and saving on the
 * first tap would file the action somewhere else — out of the list being
 * looked at, taking the open panel with it — before the second tap happened.
 *
 * So changes accumulate, and go in on Apply, or when focus leaves the block
 * entirely (tapping the list behind it, or moving on to another field), which
 * catches the edit someone walks away from.
 *
 * The composer does not use this: there is nothing to save there until the
 * whole action is added, so it drives DateFields directly.
 */
export function DateEditor({
  value,
  onSave,
  idPrefix,
}: {
  value: ActionDates;
  onSave: (next: ActionDates) => void;
  idPrefix: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ActionDates | null>(null);
  // Mirrored in a ref because a change and the blur that follows it arrive in
  // the same batch: committing a date input bubbles its blur straight up here,
  // and reading state at that point would still see the value from before the
  // change — losing the very edit being committed.
  const latest = useRef<ActionDates | null>(null);
  const dirty = draft !== null && (draft.due !== value.due || draft.showFrom !== value.showFrom);

  function change(next: ActionDates) {
    latest.current = next;
    setDraft(next);
  }

  function commit() {
    const next = latest.current;
    latest.current = null;
    setDraft(null);
    if (next && (next.due !== value.due || next.showFrom !== value.showFrom)) {
      onSave(next);
    }
  }

  // Focus moving between the fields and buttons inside this block is not
  // leaving it; only focus landing outside counts.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    commit();
  }

  return (
    <div onBlur={onBlur}>
      <DateFields value={draft ?? value} onChange={change} idPrefix={idPrefix} />
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" disabled={!dirty} onClick={commit}>
          {t("dates.apply")}
        </Button>
      </div>
    </div>
  );
}
