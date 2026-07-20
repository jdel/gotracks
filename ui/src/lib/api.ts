import type { Tokens } from "./types";

const ACCESS_KEY = "gt.access";
const REFRESH_KEY = "gt.refresh";

// Token storage in localStorage. Access token is short-lived; refresh rotates.
export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: Tokens) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  /** The parsed error body, for endpoints that return more than a message. */
  details: Record<string, unknown>;
  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const BASE = "/api/v1";

// Callbacks let the auth layer react to a forced logout when refresh fails.
let onLogout: (() => void) | null = null;
export function setOnLogout(fn: () => void) {
  onLogout = fn;
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const tokens = (await res.json()) as Tokens;
  tokenStore.set(tokens);
  return true;
}

// request is the core fetch wrapper: attaches the bearer token and, on a 401,
// transparently refreshes once and retries.
async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const access = tokenStore.access;
  if (access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && tokenStore.refresh) {
    if (await refreshTokens()) {
      return request<T>(method, path, body, false);
    }
    tokenStore.clear();
    onLogout?.();
    throw new ApiError(401, "session expired");
  }

  if (!res.ok) {
    let msg = res.statusText;
    let details: Record<string, unknown> = {};
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
      if (data && typeof data === "object") details = data;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The server's own message when there is one, else a local fallback.
 *
 * The API says things the client cannot work out for itself — which quota was
 * hit, what its ceiling is, what to delete. Replacing that with a generic
 * "could not add" throws away the only part the user can act on, so prefer the
 * server's wording and keep the fallback for transport-level failures.
 */
export function apiMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  // Auth endpoints bypass the bearer/refresh dance.
  raw: (path: string, body: unknown) =>
    request("POST", path, body, false),
};
