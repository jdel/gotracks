const CONTEXT_KEY = "gt.lastContext";

function read(key: string): number | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * lastUsed remembers the context the previous action was filed under, so
 * quick-add defaults to it instead of always falling back to the first context
 * in the list. Stored locally: it is a per-device convenience, not data.
 *
 * Only the context. A context is mandatory on an action, so guessing one saves
 * a choice that has to be made anyway; a project is optional, and inheriting
 * the last one files unrelated actions under it behind the user's back. A
 * project is set by typing "#name", or by adding from that project's page.
 */
export const lastUsed = {
  get contextId(): number | undefined {
    return read(CONTEXT_KEY);
  },
  remember(contextId?: number) {
    if (contextId) localStorage.setItem(CONTEXT_KEY, String(contextId));
  },
  clear() {
    localStorage.removeItem(CONTEXT_KEY);
  },
};
