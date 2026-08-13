import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { apiMessage, setOnLogout, tokenStore } from "./api";
import { downloadAttachment } from "./attachments";
import { downloadExport, useUploadAttachment } from "@/hooks/useSettings";
import { downloadAuditExport } from "@/hooks/useAudit";

/**
 * The file transports — upload, attachment download, account export, audit
 * export — used to be four hand-rolled fetches beside the JSON client, none of
 * which refreshed an expired token and only one of which kept the server's
 * error message. These exercise the exported operations rather than the
 * transport underneath, because "the call sites are on the shared transport" is
 * the whole point.
 */

function res(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

type Call = { url: string; auth: string | null; body: unknown };

/**
 * A fetch that answers from a queue of responses per path fragment, recording
 * the bearer each request carried — which is how "retried with the *new*
 * token" is told apart from "retried at all".
 */
function fetchStub(routes: Record<string, Response[]>) {
  const calls: Call[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("Authorization"), body: init?.body });
    // Longest match wins: "/admin/audit/export" also contains "/export", and a
    // first-match rule would quietly answer one route from another's queue.
    const key = Object.keys(routes)
      .filter((k) => url.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected request: ${url}`);
    const queued = routes[key];
    // The last response repeats, so a route only has to list what changes.
    return queued.length > 1 ? queued.shift()! : queued[0];
  });
  vi.stubGlobal("fetch", stub);
  return calls;
}

const tokens = (n: string) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresAt: "2026-08-13T00:15:00Z",
});

beforeEach(() => {
  tokenStore.set(tokens("old"));
  // jsdom implements neither, and saveBlob needs both.
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:saved"),
    revokeObjectURL: vi.fn(),
  }));
  // Clicking an <a download> is a navigation jsdom refuses to perform, and it
  // reports that on the element rather than throwing. Nothing under test cares
  // whether the browser saved the file, only that it was asked to.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setOnLogout(() => {});
  localStorage.clear();
});

describe("file transports and an expired session", () => {
  it("refreshes once and retries the download with the new token", async () => {
    const calls = fetchStub({
      "/export": [res(401, { error: "token expired" }), res(200, { archive: true })],
      "/auth/refresh": [res(200, tokens("new"))],
    });

    await downloadExport();

    const exports = calls.filter((c) => c.url.includes("/export"));
    expect(calls.filter((c) => c.url.includes("/auth/refresh"))).toHaveLength(1);
    expect(exports).toHaveLength(2);
    expect(exports[0].auth).toBe("Bearer access-old");
    expect(exports[1].auth).toBe("Bearer access-new");
    expect(tokenStore.access).toBe("access-new");
  });

  it("refreshes and retries an upload, re-sending the file", async () => {
    const calls = fetchStub({
      "/attachments": [res(401, {}), res(200, { id: 7, fileName: "notes.pdf" })],
      "/auth/refresh": [res(200, tokens("new"))],
    });

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useUploadAttachment(3), { wrapper });

    const uploaded = await result.current.mutateAsync(
      new File(["contents"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(uploaded).toMatchObject({ id: 7 });
    const uploads = calls.filter((c) => c.url.includes("/todos/3/attachments"));
    expect(uploads).toHaveLength(2);
    expect(uploads[1].auth).toBe("Bearer access-new");
    // Both carried the file, and neither declared a content type: only the
    // browser can add the multipart boundary that goes with it.
    for (const call of uploads) expect(call.body).toBeInstanceOf(FormData);
  });

  it("logs out when the refresh itself fails", async () => {
    fetchStub({
      "/attachments/9": [res(401, {})],
      "/auth/refresh": [res(401, { error: "refresh token revoked" })],
    });
    const onLogout = vi.fn();
    setOnLogout(onLogout);

    await expect(downloadAttachment(9, "notes.pdf")).rejects.toMatchObject({ status: 401 });
    expect(onLogout).toHaveBeenCalledOnce();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it("shares one refresh between two operations failing at once", async () => {
    const calls = fetchStub({
      "/export": [res(401, {}), res(200, {})],
      "/admin/audit/export": [res(401, {}), res(200, {})],
      "/auth/refresh": [res(200, tokens("new"))],
    });

    await Promise.all([
      downloadExport(),
      downloadAuditExport({ from: "", to: "", actor: "", action: "", outcome: "" }, "csv"),
    ]);

    // Refresh tokens are one-time: a second refresh would present a token the
    // first had already rotated away, and log the user out mid-download.
    expect(calls.filter((c) => c.url.includes("/auth/refresh"))).toHaveLength(1);
    expect(
      calls.filter((c) => c.auth === "Bearer access-new" && !c.url.includes("/auth/")),
    ).toHaveLength(2);
  });
});

describe("errors from file transports", () => {
  it("surfaces the server's reason an upload was refused", async () => {
    fetchStub({
      "/attachments": [res(413, { error: "attachment storage limit reached (100 MB)" })],
    });

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useUploadAttachment(3), { wrapper });

    result.current.mutate(new File(["x"], "big.bin"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // The defect this replaces: a bare Error is not an ApiError, so apiMessage
    // discarded the only sentence telling the user which limit they hit.
    expect(apiMessage(result.current.error, "could not upload")).toBe(
      "attachment storage limit reached (100 MB)",
    );
  });

  it("keeps the status a missing attachment reports", async () => {
    fetchStub({ "/attachments/9": [res(404, { error: "attachment not found" })] });

    await expect(downloadAttachment(9, "gone.pdf")).rejects.toMatchObject({
      status: 404,
      message: "attachment not found",
    });
  });
});
