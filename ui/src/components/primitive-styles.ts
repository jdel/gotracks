// Non-component exports live here so the component files stay Fast-Refresh clean
// (react-refresh/only-export-components). Class strings are normative — see
// the design handoff.

// Row actions (attach/star/delete etc) — always visible, in the flow, on the
// right of the row. (No hover-reveal: it overlapped the attachment panel and
// read as a bad interaction.)
export const rowActions = "flex shrink-0 items-center gap-0.5";

// The small bold caption above a form control, on every form.
export const fieldLabel = "text-xs font-bold text-ink-2 dark:text-ink-2-dark";

// In-place edit fields (rename an action/context/project, edit a note) strip all
// the input chrome so the field occupies exactly the space the displayed text
// did — editing never resizes the card. Callers add the matching text classes.
export const inlineEdit =
  "h-auto w-full rounded-none border-0 bg-transparent p-0 shadow-none " +
  "focus-visible:ring-0 focus-visible:outline-none";

// 42px tall, 12px radius, 2px brand border on focus. Applies to input, select
// and textarea alike — no other input style exists in the app.
export const inputClass =
  "h-[42px] w-full rounded-control border border-line-2 bg-surface px-3 text-sm font-medium text-ink " +
  "placeholder:text-ink-4 focus:border-2 focus:border-brand focus:outline-none " +
  "dark:border-line-2-dark dark:bg-card-dark dark:text-ink-dark dark:focus:border-brand-dark " +
  "aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger";
