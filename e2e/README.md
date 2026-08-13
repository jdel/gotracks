# Browser checks

A short suite that drives a real browser against a real server. It exists for
the handful of behaviours jsdom cannot model, and for nothing else:

- **a media query resolving at an actual pixel width.** The unit tests stub
  `matchMedia`, which proves a component takes the branch it is told to take. It
  cannot prove that branch agrees with the stylesheet — the breakpoint is
  written twice, as a JavaScript constant and as Tailwind's `md`, and a drift
  between them is invisible to a stub. 767px and 768px are the only widths that
  catch it.
- **touch pointers.** The row gestures ignore anything whose `pointerType` is
  not `touch`, so that desktop drag-and-drop and hover keep working. A test that
  presses a mouse exercises nothing.
- **a session refresh end to end**, where the token the server refuses, the
  refresh it accepts and the rotated token it returns all have to fit together.
  A fetch stub asserts the client against fixtures written by the same hand as
  the client.

Everything else belongs in `ui/src/**/*.test.tsx`, which runs in milliseconds on
every change.

## Running

One-time setup — Playwright and the browser it drives are not in the repo:

```sh
npm install --prefix e2e
npx --prefix e2e playwright install chromium     # ~150 MB, into ~/.cache/ms-playwright
```

Then, from the repo root:

```sh
make e2e
```

That builds `gotracks` first, because the suite runs the binary.

## How it boots

No fixture database. Each run starts a server on a temporary SQLite file, and
creates the first account — which is the administrator — through the real
enrollment flow: request an invitation, read the link out of the log (with no
mail provider configured the mailer writes the message to the log), accept it,
set a password. Fixtures for a screen are then created over the API, which is
faster than driving forms and is not what any of these tests are about.

The database and its log are removed when the run finishes.
