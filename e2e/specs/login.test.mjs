import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "../harness.mjs";

/**
 * The sign-in card sits below the brand bar, not on top of it.
 *
 * Layout, so jsdom cannot answer it. The card used to be pulled up 30px, which
 * was sized for a brand panel carrying the marketing line — and that line is
 * empty in every locale, so on a phone the panel is a 96px bar and the card
 * covered a third of it, leaving 14px of purple under the wordmark.
 *
 * No account and no session: the login page is the one screen that needs
 * neither, which is why this drives the browser directly rather than through
 * `openApp`.
 */
describe("the login page on a phone", () => {
  let server;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.stop();
  });

  it("keeps the sign-in card clear of the brand bar", async () => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 375, height: 780 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.goto(`${server.base}/login`);
      await page.getByLabel(/email/i).first().waitFor();

      const bar = await page.locator("div.bg-brand, div.bg-brand-header").first().boundingBox();
      // The card is the panel the heading lives in.
      const card = await page
        .locator("h2")
        .first()
        .evaluate((h) => {
          const { x, y, height } = h.closest("div").getBoundingClientRect();
          return { x, y, height };
        });

      assert.ok(
        card.y >= bar.y + bar.height,
        `the sign-in card (top ${Math.round(card.y)}px) overlaps the brand bar ` +
          `(ends ${Math.round(bar.y + bar.height)}px)`,
      );
      // And it has not been pushed off the screen in the other direction.
      assert.ok(
        card.y < 200,
        `the sign-in card starts ${Math.round(card.y)}px down, which is not "under the bar"`,
      );
    } finally {
      await browser.close();
    }
  });
});
