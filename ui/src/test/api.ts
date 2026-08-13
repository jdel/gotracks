import { vi } from "vitest";

/**
 * A fake server for tests, routed on method and path.
 *
 * Every test file used to define its own, and they all matched with
 * `url.includes(...)`, which answers the wrong question the moment two routes
 * share a prefix. Both of these are real:
 *
 * (A note on wording, learned the hard way: Tailwind scans this file like any
 * other, so a bare utility name written in prose is emitted into the
 * stylesheet. Prefer a phrasing that does not name one — this comment used to,
 * and put a class nobody asked for into every build.)
 *
 *     "/export"      also matches  /admin/audit/export
 *     "/attachments" also matches  /todos/3/attachments
 *
 * In both cases a test went green while the server had answered a different
 * endpoint. Matching here is exact, segment by segment, and an unrouted request
 * throws with the method and path — a route somebody forgot is a loud failure
 * rather than a quiet 404 that some component treats as an empty list.
 */

export interface ApiCall {
  method: string;
  /** Path with the /api/v1 prefix removed, query string included. */
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
}

/**
 * What a route answers: a value to send as JSON, a `reply()` for a status other
 * than 200, or a function of the request. `sequence(...)` scripts several
 * answers for the same route.
 */
type Handler = (call: ApiCall) => unknown;
/**
 * Spelled out rather than `unknown`: a union containing `unknown` collapses to
 * `unknown`, and a route written as a function would then be handed an
 * untyped argument at every call site.
 */
type Data = Record<string, unknown> | unknown[] | string | number | boolean | null | Reply;
type Answer = Data | Handler;
interface Script {
  __sequence: Answer[];
}
type Route = Answer | Script;

export interface Reply {
  __reply: true;
  status: number;
  body: unknown;
}

/** An answer with a status of its own: `reply(409, { error: "in use" })`. */
export function reply(status: number, body: unknown = {}): Reply {
  return { __reply: true, status, body };
}

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && "__reply" in value;
}

function isScript(value: unknown): value is Script {
  return typeof value === "object" && value !== null && "__sequence" in value;
}

/** "PUT /todos/:id" against "PUT /todos/7" → { id: "7" }. */
function match(pattern: string, method: string, path: string) {
  const [wantMethod, wantPath] = pattern.split(" ");
  if (wantMethod !== method) return null;
  const want = wantPath.split("/").filter(Boolean);
  const got = path.split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of want.entries()) {
    if (segment.startsWith(":")) params[segment.slice(1)] = got[i];
    else if (segment !== got[i]) return null;
  }
  return params;
}

export interface MockApi {
  /** Every request made, in order. */
  calls: ApiCall[];
  /** The requests that changed something — everything but GET. */
  writes: () => ApiCall[];
  /** The body of the last write, which is what most assertions want. */
  lastBody: () => unknown;
}

/**
 * Installs the fake server. Routes are `"METHOD /path"` with `:name` segments;
 * the `/api/v1` prefix is implied.
 *
 *     const api = mockApi({
 *       "GET /todos": [aTodo({ description: "buy paint" })],
 *       "PUT /todos/:id": ({ params, body }) => ({ id: Number(params.id), ...body }),
 *       "DELETE /attachments/9": reply(409, { error: "attachment is in use" }),
 *     });
 */
export function mockApi(routes: Record<string, Route>): MockApi {
  const calls: ApiCall[] = [];
  const remaining = new Map<string, Answer[]>();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, "");

      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else if (init?.body !== undefined) {
        body = init.body; // FormData, and anything else that is not JSON.
      }

      for (const [pattern, route] of Object.entries(routes)) {
        const params = match(pattern, method, path);
        if (!params) continue;

        const call: ApiCall = { method, path: url.pathname, query: url.searchParams, params, body };
        calls.push(call);

        // A bare array is data — a list of rows is the commonest answer there
        // is — so only a script built with `sequence()` is consumed one call at
        // a time. Guessing from the shape would make `[aTodo()]` mean two
        // different things depending on how many calls a test happened to make.
        let answer: Answer;
        if (isScript(route)) {
          const queue = remaining.get(pattern) ?? [...route.__sequence];
          remaining.set(pattern, queue);
          answer = queue.length > 1 ? queue.shift()! : queue[0];
        } else {
          answer = route;
        }
        if (typeof answer === "function") answer = (answer as Handler)(call) as Data;

        const status = isReply(answer) ? answer.status : 200;
        const payload = isReply(answer) ? answer.body : answer;
        return {
          ok: status < 400,
          status,
          statusText: `status ${status}`,
          json: async () => payload,
          blob: async () => new Blob([JSON.stringify(payload ?? {})]),
        } as Response;
      }

      throw new Error(
        `no route for ${method} ${path} — add it to mockApi({...}), or fix the ` +
          `request. Known routes: ${Object.keys(routes).join(", ")}`,
      );
    }),
  );

  return {
    calls,
    writes: () => calls.filter((c) => c.method !== "GET"),
    lastBody: () => calls.filter((c) => c.method !== "GET").at(-1)?.body,
  };
}

/**
 * A scripted series of answers for one route: the first call gets the first,
 * and the last repeats — `sequence(reply(401), aTodo())` is "fails once, then
 * works". Wrapping is what tells a script apart from a list of rows that simply
 * is the answer.
 */
export function sequence(...answers: Answer[]): Script {
  return { __sequence: answers };
}
