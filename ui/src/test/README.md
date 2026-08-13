# Writing tests here

## The rule that matters more than anything below

**Undo the fix and watch the test fail.** A test written alongside a change and
never seen red is not evidence; it is a hope. Three tests written during one
week of this project passed against the *unfixed* code:

- a swipe test whose harness never reached the row it was swiping;
- a keyboard test asserting a form submission jsdom never performs anyway;
- a "new action inherits no project" test whose own fixture had dropped
  `projectId`, so it asserted nothing.

Better fixtures would not have caught any of the three. Only `git stash`-ing the
source file, running the test, and seeing it go red did. It costs ten seconds:

```sh
git stash push -q src/components/Thing.tsx
npx vitest run src/components/Thing.test.tsx     # must fail, for the right reason
git stash pop -q
```

"For the right reason" is part of it — a test that fails because the component
no longer compiles has told you nothing.

## What is here

- **`api.ts`** — `mockApi()`, a fake server routed on method and path.
- **`render.tsx`** — `renderWithProviders()`: a retry-disabled query client, a
  router, optionally the undo provider and a viewport.
- **`fixtures.ts`** — `aTodo()`, `aContext()`, `aProject()`, `aRecurrence()`,
  `anAttachment()`, `aUser()`: rows shaped like the server's.
- **`viewport.ts`** — `setViewport("phone" | "desktop")`, since jsdom implements
  no `matchMedia` at all.

```tsx
const api = mockApi({
  "GET /todos": [aTodo({ description: "buy paint" })],
  "GET /contexts": [aContext()],
  "PUT /todos/:id": ({ params, body }) => ({ id: Number(params.id), ...body }),
  "DELETE /attachments/:id": reply(409, { error: "attachment is in use" }),
});

renderWithProviders(<HomePage />, { viewport: "desktop", undo: true });

await user.click(screen.getByRole("button", { name: "Save" }));
expect(api.lastBody()).toMatchObject({ description: "buy paint" });
```

Use `sequence(reply(401), aTodo())` when one route must answer differently on
successive calls — "fails once, then works" is how a token refresh is tested.

## Why the routing is exact

The hand-rolled fetch stubs this replaces all matched with `url.includes(...)`,
which answers the wrong question as soon as two routes share a prefix:

    "/export"       also matches  /admin/audit/export
    "/attachments"  also matches  /todos/3/attachments

Both happened, and in both cases a test went green while the stub had answered a
different endpoint. `mockApi` matches segment by segment, and throws on a
request it has no route for — a forgotten route is then a loud failure rather
than a quiet 404 that a component renders as an empty list.

## Asserting on classes and structure

Prefer a role, a label or visible text: they survive a refactor and they
describe what a person sees. Reach for a class or a DOM shape only when the
contract genuinely is visual, and say why in a comment. Two legitimate examples
in this suite:

- the sidebar's layout classes, which the design handoff specifies literally;
- the weekday picker's border width, because the defect is two pixels, jsdom has
  no layout engine, and the browser suite is not installed by default.

Anything of the form `aside > div:last-child` is not a contract. It is a test
that will fail on a day nobody changed the behaviour.

## What belongs in the browser suite instead

`e2e/` drives a real browser against a real server. Things that cannot be
modelled here go there: a media query resolving at a real pixel width, touch
pointers, a browser's own form submission, a token refresh end to end. See
`e2e/README.md`.
