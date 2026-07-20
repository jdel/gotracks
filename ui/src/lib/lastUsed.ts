const CONTEXT_KEY = "gt.lastContext";
const PROJECT_KEY = "gt.lastProject";

function read(key: string): number | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * lastUsed remembers where the previous action was filed, so quick-add defaults
 * to the same context and project instead of always falling back to the first
 * context in the list. Stored locally: it is a per-device convenience, not data.
 */
export const lastUsed = {
  get contextId(): number | undefined {
    return read(CONTEXT_KEY);
  },
  get projectId(): number | undefined {
    return read(PROJECT_KEY);
  },
  remember(contextId?: number, projectId?: number) {
    if (contextId) localStorage.setItem(CONTEXT_KEY, String(contextId));
    // A project is optional on an action; clear the memory when one was not used
    // so the next action does not silently inherit a stale project.
    if (projectId) localStorage.setItem(PROJECT_KEY, String(projectId));
    else localStorage.removeItem(PROJECT_KEY);
  },
  clear() {
    localStorage.removeItem(CONTEXT_KEY);
    localStorage.removeItem(PROJECT_KEY);
  },
};
