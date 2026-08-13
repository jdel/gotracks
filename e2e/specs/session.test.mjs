import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFirstAccount, openApp, post, signIn, startServer } from "../harness.mjs";

/**
 * An expired access token, against a server that really issues them.
 *
 * The unit tests script a fetch stub: they prove the client refreshes and
 * retries when a canned 401 arrives. What they cannot prove is that the token
 * the server rejects, the refresh the server accepts and the rotated token it
 * returns fit together — the shapes are asserted against fixtures written by
 * the same hand as the code.
 */
describe("a session that expires while the app is open", () => {
  let server;
  let tokens;

  before(async () => {
    server = await startServer();
    await createFirstAccount(server);
    tokens = await signIn(server);
    const context = await post(server, tokens, "/contexts", { name: "home" });
    await post(server, tokens, "/todos", {
      contextId: context.id,
      description: "buy paint",
    });
  });

  after(async () => {
    await server.stop();
  });

  it("refreshes once and carries on, without bouncing to the login page", async () => {
    // A real refresh token, and an access token the server will refuse. Exactly
    // the state a tab left open overnight wakes up in.
    const { browser, page } = await openApp(
      server,
      { accessToken: "not-a-token", refreshToken: tokens.refreshToken },
      { width: 1280 },
    );
    try {
      const requests = [];
      page.on("request", (req) => requests.push(req.url()));

      const row = page.locator("li").filter({ hasText: "buy paint" }).first();
      await row.waitFor({ timeout: 15000 });

      const refreshes = requests.filter((url) => url.includes("/auth/refresh"));
      assert.equal(refreshes.length, 1, "one refresh, however many requests 401 at once");
      assert.ok(!page.url().includes("/login"), "a recoverable session is not a logout");

      // The rotated token is what the app kept: reusing the consumed one would
      // work until the next expiry and then log the user out for good.
      const stored = await page.evaluate(() => localStorage.getItem("gt.refresh"));
      assert.notEqual(stored, tokens.refreshToken, "the refresh token rotates");
    } finally {
      await browser.close();
    }
  });

  it("sends a dead session to the login page", async () => {
    const { browser, page } = await openApp(
      server,
      { accessToken: "not-a-token", refreshToken: "not-a-token-either" },
      { width: 1280 },
    );
    try {
      await page.waitForURL(/\/login/, { timeout: 15000 });
      const stored = await page.evaluate(() => localStorage.getItem("gt.refresh"));
      assert.equal(stored, null, "the tokens go with the session");
    } finally {
      await browser.close();
    }
  });
});
