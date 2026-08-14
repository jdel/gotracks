import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createFirstAccount,
  openApp,
  post,
  signIn,
  startServer,
} from "../harness.mjs";

/**
 * The date row fits the screen it is on.
 *
 * A layout question, so jsdom cannot answer it: it has no layout engine at all,
 * and every unit test here would pass against a field overflowing its row. The
 * failure was reported from a real phone — the date field kept its intrinsic
 * width, overran the row and covered the button that clears it, so the only way
 * to remove a date was to select the text and delete it.
 *
 * 375px is an iPhone SE / mini, the narrowest width worth supporting.
 */
describe("the date fields on a narrow screen", () => {
  let server;
  let tokens;

  before(async () => {
    server = await startServer();
    await createFirstAccount(server);
    tokens = await signIn(server);
    const context = await post(server, tokens, "/contexts", { name: "home" });
    // No due date here: one given a due date is deferred into the tickler and
    // is not on the list this test opens. The date is set from the editor,
    // which is also how the clear button appears.
    await post(server, tokens, "/todos", {
      contextId: context.id,
      description: "buy paint",
    });
  });

  after(async () => {
    await server.stop();
  });

  it("keeps the clear button clear of the field", async () => {
    const { browser, page } = await openApp(server, tokens, { width: 375 });
    try {
      const row = page.locator("li").filter({ hasText: "buy paint" }).first();
      await row.waitFor();
      await page.getByLabel("Edit this action").click();

      const sheet = page.locator("[role='dialog']");
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "Tomorrow" }).first().click();

      const field = sheet.getByLabel("Due", { exact: true });
      const clear = sheet.getByLabel("Clear the due date");
      await clear.waitFor();

      // Why the mechanism and not only the symptom: iOS Safari gives a date
      // input a much wider intrinsic width than Chromium does, and Chromium is
      // the only browser this suite drives. The overflow itself does not
      // reproduce here — checked, by reverting the fix and watching this pass —
      // so the assertion that can fail is the one on the rule that prevents it.
      const minWidth = await field.evaluate((el) => getComputedStyle(el.closest("label")).minWidth);
      assert.equal(
        minWidth,
        "0px",
        "the field's label must be allowed to shrink; a flex item's min-width is " +
          "auto, which on iOS is the whole date plus the picker button",
      );

      const [fieldBox, clearBox] = await Promise.all([field.boundingBox(), clear.boundingBox()]);

      // The symptom, for the day a browser here does reproduce it: the field
      // ends before the button starts. Overlapping is the bug — the button was
      // still in the DOM and still clickable, under a field drawn over it.
      assert.ok(
        fieldBox.x + fieldBox.width <= clearBox.x + 1,
        `the due field (ends at ${Math.round(fieldBox.x + fieldBox.width)}px) runs under its ` +
          `clear button (starts at ${Math.round(clearBox.x)}px)`,
      );
      assert.ok(
        clearBox.x + clearBox.width <= 375,
        `the clear button (ends at ${Math.round(clearBox.x + clearBox.width)}px) is off a 375px screen`,
      );
    } finally {
      await browser.close();
    }
  });
});
