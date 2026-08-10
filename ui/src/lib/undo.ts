import { createContext, useContext } from "react";

// The context and its hook live apart from the provider component so the
// provider file only exports components (react-refresh/only-export-components),
// the same split as components/primitive-styles.ts.

export interface UndoApi {
  /** The key of the operation currently pending, if any. */
  pendingKey: string | null;
  /** Apply `key` optimistically, show the toast, and run `commit` after 5s unless undone. */
  schedule: (key: string, message: string, commit: () => void) => void;
  /** Abandon the pending operation without committing it. With `key`, only if it matches. */
  cancel: (key?: string) => void;
}

export const UndoContext = createContext<UndoApi | null>(null);

/** How long the toast stays up before the operation becomes real. */
export const UNDO_DELAY = 5000;

// Outside a provider (e.g. isolated component tests) the mutation is immediate
// with no toast — the caller's commit runs at once, so behaviour degrades safely.
const fallback: UndoApi = {
  pendingKey: null,
  schedule: (_key, _message, commit) => commit(),
  cancel: () => {},
};

export function useUndo(): UndoApi {
  return useContext(UndoContext) ?? fallback;
}
