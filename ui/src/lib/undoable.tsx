import { useCallback, useRef, useState, type ReactNode } from "react";
import { UndoToast } from "@/components/primitives";
import { useT } from "@/lib/i18n";
import { UNDO_DELAY, UndoContext } from "@/lib/undo";

// Deferred, undoable mutations. The UI reflects the outcome immediately (the row
// hides for a delete, strikes through for a completion), a toast offers Undo for
// 5s, and the real mutation only runs when the toast expires — so nothing leaves
// the data unless it isn't undone.
// One pending operation at a time; starting another commits the previous one.

interface Pending {
  key: string;
  message: string;
  commit: () => void;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Commit and clear the current pending operation immediately.
  const flush = useCallback(() => {
    clearTimer();
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.commit();
  }, []);

  const schedule = useCallback(
    (key: string, message: string, commit: () => void) => {
      // A new operation commits whatever was still pending.
      flush();
      const p: Pending = { key, message, commit };
      pendingRef.current = p;
      setPending(p);
      timerRef.current = setTimeout(() => {
        if (pendingRef.current?.key === key) {
          pendingRef.current = null;
          setPending(null);
          commit();
        }
      }, UNDO_DELAY);
    },
    [flush],
  );

  const cancel = useCallback((key?: string) => {
    if (key != null && pendingRef.current?.key !== key) return;
    clearTimer();
    pendingRef.current = null;
    setPending(null);
  }, []);

  return (
    <UndoContext.Provider value={{ pendingKey: pending?.key ?? null, schedule, cancel }}>
      {children}
      {pending && (
        <UndoToast message={pending.message} undoLabel={t("common.undo")} onUndo={() => cancel()} />
      )}
    </UndoContext.Provider>
  );
}
