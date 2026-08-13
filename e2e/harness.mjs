// Boots a real gotracks against a throwaway database and opens a real browser.
//
// The suite exists for the handful of behaviours jsdom cannot model — a media
// query resolving at an actual pixel width, pointer capture, a browser's own
// form submission, focus inside a portal. Everything jsdom *can* model is
// tested in ui/src, which is faster and runs on every change; this runs when
// somebody asks for it.
//
// No fixture database: the instance starts empty and the first account is
// created through the real enrollment flow. With no mail provider configured
// the mailer writes the message to the log, which is where the invitation link
// is read from — the same trick the screenshot tooling uses, and it keeps the
// suite from depending on a binary blob nobody can regenerate.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

export const PASSWORD = "Browser-Suite-1!";
export const EMAIL = "first@example.test";

const ROOT = new URL("..", import.meta.url).pathname;
const BINARY = join(ROOT, "gotracks");

/** Waits for `check` to stop throwing, or gives up with the last failure. */
async function until(check, { attempts = 100, every = 100 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await check();
    } catch (err) {
      last = err;
      await sleep(every);
    }
  }
  throw last;
}

/**
 * Starts the server on a port the OS picks for us, so two runs never collide.
 * Returns the base URL and a stop() that also removes the database.
 */
export async function startServer() {
  const dir = await mkdtemp(join(tmpdir(), "gotracks-e2e-"));
  const logPath = join(dir, "server.log");
  const log = createWriteStream(logPath);
  // Port 0 would be ideal but the address is only reported in the log, so a
  // high fixed port derived from the pid is simpler and just as collision-free
  // in practice.
  const port = 20000 + (process.pid % 20000);
  const proc = spawn(
    BINARY,
    [
      "serve",
      "--http.addr", `127.0.0.1:${port}`,
      "--db.url", `sqlite:${join(dir, "e2e.db")}`,
      // Off: it binds a second port and this suite never reads it.
      "--metrics.addr", "",
      // Links in mail are built from this, and the mailer is the log, so this
      // is where the invitation link's host comes from.
      "--http.public-url", `http://127.0.0.1:${port}`,
      "--auth.jwt-secret", "e2e-secret-not-a-real-one",
    ],
    { cwd: ROOT },
  );
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);

  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    const res = await fetch(`${base}/healthz`);
    if (!res.ok) throw new Error(`healthz ${res.status}`);
  });

  return {
    base,
    /** Everything the log mailer has written so far. */
    log: () => readFile(logPath, "utf8"),
    async stop() {
      proc.kill();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Creates the first account — which is the administrator — the way a person
 * would: request enrollment, take the mailed link, set a password.
 */
export async function createFirstAccount(server) {
  const res = await fetch(`${server.base}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, timeZone: "UTC" }),
  });
  if (res.status !== 204) throw new Error(`register: ${res.status} ${await res.text()}`);

  const token = await until(async () => {
    const text = await server.log();
    const match = [...text.matchAll(/accept-invitation\?token=([A-Za-z0-9._-]+)/g)].pop();
    if (!match) throw new Error("no invitation link in the log yet");
    return match[1];
  });

  const accept = await fetch(`${server.base}/api/v1/auth/invitation/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: PASSWORD, acceptLegal: true }),
  });
  if (!accept.ok) throw new Error(`accept: ${accept.status} ${await accept.text()}`);
  return accept.json();
}

/** Signs in over the API. Faster than driving the form, and not what is under test. */
export async function signIn(server) {
  const res = await fetch(`${server.base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login: ${res.status} ${await res.text()}`);
  return (await res.json()).tokens;
}

/** POSTs as the signed-in user, for building the fixtures a screen needs. */
export async function post(server, tokens, path, body) {
  const res = await fetch(`${server.base}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokens.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Opens a page at a given viewport with the session already in localStorage,
 * so a test starts on the screen it is about rather than on the login form.
 */
export async function openApp(server, tokens, { width, height = 900, path = "/" } = {}) {
  const browser = await chromium.launch();
  // Below the breakpoint the browser is a phone in every respect that matters:
  // the row gestures ignore anything whose pointerType is not "touch", so a
  // context without touch would silently exercise nothing.
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 768,
    isMobile: width < 768,
  });
  await context.addInitScript(
    ([access, refresh]) => {
      localStorage.setItem("gt.access", access);
      localStorage.setItem("gt.refresh", refresh);
    },
    [tokens.accessToken, tokens.refreshToken],
  );
  const page = await context.newPage();
  await page.goto(`${server.base}${path}`);
  return { browser, page };
}
