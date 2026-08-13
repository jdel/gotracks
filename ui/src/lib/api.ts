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

// Single-flight the refresh. Refresh tokens are one-time (they rotate), so if
// several requests 401 at once — e.g. /me and /preferences at boot — each firing
// its own refresh would have the first rotate the token and the rest reuse the
// now-consumed one, get 401, and log the user out. Sharing one in-flight refresh
// lets every waiter retry with the single new token.
let refreshInFlight: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
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
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** The server's wording where it gave any, else the status line. */
async function errorFrom(res: Response): Promise<ApiError> {
  let msg = res.statusText;
  let details: Record<string, unknown> = {};
  try {
    const data = await res.json();
    if (data?.error) msg = data.error;
    if (data && typeof data === "object") details = data;
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, msg, details);
}

/**
 * The authenticated transport, and nothing else.
 *
 * Deliberately separate from encoding and decoding: an upload sends multipart,
 * a download receives a blob, and neither should have to reimplement the bearer
 * header, the single-flight refresh, the one retry, the forced logout and the
 * `ApiError` — which is exactly what they used to do, each slightly
 * differently. Returns the `Response` untouched; what to do with the body is
 * the caller's business.
 *
 * `auth: false` is for the public auth endpoints: no bearer header, and no
 * refresh/retry either. Refreshing a session while signing in or out is
 * meaningless, and on `/auth/refresh` itself it would recurse.
 */
async function authedFetch(
  path: string,
  init: RequestInit = {},
  { auth = true, retry = true }: { auth?: boolean; retry?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const access = auth ? tokenStore.access : null;
  if (access) headers.set("Authorization", `Bearer ${access}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (auth && res.status === 401 && retry && tokenStore.refresh) {
    // A retried upload re-sends the file: a 401 is rejected before the body is
    // processed, so nothing was stored, and a FormData can be sent twice.
    if (await refreshTokens()) return authedFetch(path, init, { auth, retry: false });
    tokenStore.clear();
    onLogout?.();
    throw new ApiError(401, "session expired");
  }

  if (!res.ok) throw await errorFrom(res);
  return res;
}

// request is the JSON wrapper over that transport: encode, call, decode.
async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const res = await authedFetch(
    path,
    {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    { auth },
  );

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
  raw: (path: string, body: unknown) => request("POST", path, body, false),
  /**
   * A download, with auth. A plain `<a href>` cannot carry the bearer header,
   * so the bytes are fetched and handed to `saveBlob`.
   */
  blob: async (path: string): Promise<Blob> => (await authedFetch(path)).blob(),
  /**
   * A multipart upload. `Content-Type` is left unset on purpose: only the
   * browser can add the boundary that goes with it, and setting it by hand
   * produces a body the server cannot parse. This is the reason uploads
   * originally went around the client altogether.
   */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await authedFetch(path, { method: "POST", body: form });
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  },
};
