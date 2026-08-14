import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/primitives";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerOption {
  /** "" is a legitimate value: it is how "no project" is chosen. */
  value: string;
  label: string;
}

/** The "make this one" row, told apart from an option by identity. */
const CREATE = Symbol("create");

/** Names are matched the way people mean them: case and padding aside. */
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A select you can type into.
 *
 * A native select is fine for four contexts and useless for forty: it has no
 * way to narrow the list. This keeps the same shape — a field showing the
 * current choice — and opens a filter box over it.
 *
 * Translation-agnostic like the primitives: every string is passed in already
 * translated.
 */
export function FilterPicker({
  value,
  options,
  onChange,
  onCreate,
  createLabel,
  ariaLabel,
  filterLabel,
  noMatchLabel,
  className,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /**
   * Offers to make what was typed. Omit it and the picker only chooses from
   * what exists — which is what a time zone list wants.
   */
  onCreate?: (name: string) => void;
  /** Already translated, like every other string here: `Create "errands"`. */
  createLabel?: (name: string) => string;
  ariaLabel: string;
  filterLabel: string;
  noMatchLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query));
  }, [filter, options]);

  const typed = filter.trim();
  /**
   * Creating is offered whenever the typed name is not already an option,
   * exactly — not merely when nothing matches. "err" is a name somebody may
   * want while "errands" exists, and a list that hides the offer because a
   * longer name contains those letters refuses to make it at all.
   */
  const canCreate =
    Boolean(onCreate) && typed.length > 0 && !options.some((o) => eq(o.label, typed));
  /** The list the arrows walk: the matches, then the offer to create. */
  const rows: (PickerOption | typeof CREATE)[] = canCreate ? [...shown, CREATE] : shown;

  const selected = options.find((o) => o.value === value);
  // Which option the arrow keys are on. Reset whenever the list changes under
  // them, so "third item" never means a different third item.
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLInputElement>(null);

  function close({ restoreFocus = true } = {}) {
    setOpen(false);
    setFilter("");
    setActive(0);
    // Nothing else puts focus back. The dialog primitive's own restore is
    // refused (so Tab can move onward instead of bouncing back), which leaves
    // every other way out — Enter, Escape, a click — with focus on a panel that
    // is being removed. It lands on the first thing in the document, which is
    // the sidebar's collapse button, half a screen away from what the user was
    // doing.
    if (restoreFocus) anchor.current?.focus();
  }

  function pick(row: (typeof rows)[number] | undefined) {
    if (!row) return;
    if (row === CREATE) onCreate?.(typed);
    else onChange(row.value);
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // A click outside closes without pulling focus back: the user is
        // already on their way somewhere else.
        if (!next) close({ restoreFocus: false });
        else setOpen(true);
      }}
    >
      <PopoverAnchor asChild>
        <Input
          ref={anchor}
          className={className}
          value={selected?.label ?? ""}
          readOnly
          // Opens on a deliberate act, not on focus. Focus arrives by itself —
          // a sheet moving focus to its first control would otherwise drop a
          // list over the form the moment it opened.
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              return;
            }
            // Typing goes straight into the filter. The field itself is
            // read-only — it shows the choice, it is not an edit box — so
            // without this a keyboard user has to open the list first and only
            // then start typing, which is a step nobody expects to need.
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              setFilter(e.key);
              setActive(0);
              setOpen(true);
            }
          }}
          aria-label={ariaLabel}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[min(20rem,calc(100vw-2rem))] p-1"
        // Tab hands focus onward rather than back to the field that opened
        // this, so the list behaves like part of the form it sits in.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => close()}
      >
        <Input
          autoFocus
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          placeholder={`${filterLabel}…`}
          aria-label={filterLabel}
          // The list is driven from here: the options are not tab stops, so
          // Tab leaves the field entirely instead of walking forty contexts.
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(rows[active]);
            } else if (e.key === "Escape") {
              // Closes the list and stops there: the panel around it also
              // listens for Escape, and one press should undo one thing.
              e.stopPropagation();
              close();
            } else if (e.key === "Tab") {
              // Close and put focus back on the field this belongs to, then let
              // the browser's own Tab carry on to whatever follows it.
              close();
            }
          }}
        />
        <div className="mt-1 max-h-56 overflow-y-auto">
          {rows.map((row, i) => (
            <button
              key={row === CREATE ? "__create" : row.value}
              type="button"
              // Never a tab stop: arrows move through the list, Tab leaves it.
              tabIndex={-1}
              className={cn(
                "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                i === active && "bg-accent",
                // The offer to create is not one of the things that exist, and
                // is set apart from them rather than sitting in the run of
                // names as if it were another one.
                row === CREATE && "mt-1 border-t border-line font-semibold dark:border-line-dark",
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(row)}
            >
              {row === CREATE ? createLabel?.(typed) : row.label}
            </button>
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{noMatchLabel}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
