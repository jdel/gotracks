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
 * One presentation per viewport, checked at the pixel where it changes.
 *
 * The unit tests stub `matchMedia`, which proves the component takes the branch
 * it is told to take. It cannot prove the branch agrees with the stylesheet:
 * the breakpoint exists twice, as a JavaScript constant and as Tailwind's `md`,
 * and a drift between them is invisible to a stub. 767 and 768 are the only
 * widths that catch it.
 *
 * The failure this replaces was real: on a desktop, opening the editor rendered
 * the inline panel *and* the phone's modal sheet over the top of it, because a
 * sheet renders through a portal and the `md:hidden` wrapper could not reach it.
 */
describe("one presentation per viewport", () => {
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

  /** Opens the editor of the first action and reports what got mounted. */
  async function openEditor(width) {
    const { browser, page } = await openApp(server, tokens, { width });
    try {
      // The row, not its text: once a sheet opens, its heading repeats the
      // description and a text locator matches both.
      const row = page.locator("li").filter({ hasText: "buy paint" }).first();
      await row.waitFor();

      // The same pencil at both widths. A phone used to hold the row instead,
      // which the browser reads first as a request to select text: it put its
      // own selection handles over the editor. What still differs either side
      // of the breakpoint is the presentation, which is what this asserts.
      await page.getByLabel("Edit this action").click();
      await page.waitForTimeout(400);
      return {
        dialogs: await page.locator("[role='dialog']").count(),
        editors: await page.getByLabel("Tags (comma separated)").count(),
      };
    } finally {
      await browser.close();
    }
  }

  it("expands inside the card at 768px, with no modal", async () => {
    const seen = await openEditor(768);
    assert.equal(seen.dialogs, 0, "a desktop must not open the phone's sheet");
    assert.equal(seen.editors, 1, "exactly one editor is mounted");
  });

  it("opens a single sheet at 767px", async () => {
    const seen = await openEditor(767);
    assert.equal(seen.dialogs, 1, "a phone opens the sheet");
    assert.equal(seen.editors, 1, "and does not also mount the inline panel");
  });
});
