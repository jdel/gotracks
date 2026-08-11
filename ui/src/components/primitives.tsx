import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/* gotracks — the shared UI primitives every screen is built from.
 * The Tailwind class strings are normative — do not paraphrase them, and do not
 * introduce colours, radii or shadows that are not tokens. Primitives are
 * translation-agnostic: callers pass already-translated strings / nodes. */

/* Application mark: rounded square + an 800-weight "g". The teal status dot only
 * appears at 32px and up. Never an SVG logo file. */
export function Mark({
  size = 32,
  dot = false,
  className = "bg-brand text-white",
}: {
  size?: number;
  dot?: boolean;
  className?: string;
}) {
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={cn(
        "relative flex flex-none items-center justify-center rounded-mark font-extrabold leading-none",
        className,
      )}
      aria-hidden="true"
    >
      g
      {dot && size >= 32 && (
        <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-done dark:border-card-dark" />
      )}
    </div>
  );
}

export interface Metric {
  value?: ReactNode;
  label: ReactNode;
  tone?: "done";
}

/* The single strongest brand element. Full-bleed on mobile, a rounded panel on
 * desktop. `metrics` is 2–3 short items; the number is 800 and full white.
 * `back` replaces the wordmark on second-level screens; `action` replaces the
 * avatar when the screen has one primary action. */
export function HeaderBlock({
  title,
  metrics = [],
  back,
  onBack,
  action,
  avatar = "JD",
}: {
  title: ReactNode;
  metrics?: Metric[];
  back?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
  avatar?: ReactNode;
}) {
  const backButton = (extra: string) => (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        "flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white",
        extra,
      )}
    >
      <ArrowLeft className="size-3.5" /> {back}
    </button>
  );

  return (
    <header className="bg-brand px-4 pt-3.5 pb-5 text-white md:rounded-panel md:px-6 md:py-5 dark:bg-brand-header">
      {/* Mobile top row: mark + wordmark (or back) on the left, avatar (or the
          screen's action) on the right. On desktop the sidebar carries the mark
          and there is no avatar, so this row is hidden. */}
      <div className="flex items-center justify-between md:hidden">
        {back ? (
          backButton("")
        ) : (
          <div className="flex items-center gap-1.5">
            <Mark size={20} className="bg-white text-brand dark:bg-brand-dark dark:text-ink" />
            <span className="text-base font-extrabold tracking-[-0.045em]">gotracks</span>
          </div>
        )}
        {action ?? (
          <div className="flex size-[26px] items-center justify-center rounded-full bg-white/[0.18] text-[10px] font-extrabold">
            {avatar}
          </div>
        )}
      </div>

      {/* Desktop: a back link sits above the title (no brand row, no avatar). */}
      {back && backButton("mb-1 hidden md:flex")}

      <div className="md:flex md:items-end md:justify-between md:gap-4">
        <div className="min-w-0">
          <h1 className="mt-4 text-[23px] leading-tight font-extrabold tracking-[-0.04em] md:mt-0 md:text-3xl">
            {title}
          </h1>
          {metrics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-medium text-white/[0.78]">
              {metrics.map((m, i) => (
                <span key={i}>
                  {m.value != null && (
                    <span
                      className={cn(
                        "font-extrabold",
                        m.tone === "done" ? "text-done-on-brand dark:text-done-dark" : "text-white",
                      )}
                    >
                      {m.value}{" "}
                    </span>
                  )}
                  {m.label}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* The action shows top-right on mobile (replacing the avatar) and to the
            right of the title on desktop. */}
        {action && <div className="mt-3 hidden shrink-0 md:mt-0 md:block">{action}</div>}
      </div>
    </header>
  );
}

/* Mobile-only primary create action. Replaces the inline "New …" row. The host
 * must reserve pb-[126px] on the scroll area so the last row never sits under it. */
export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed right-4 bottom-[74px] z-40 flex size-[52px] items-center justify-center rounded-panel bg-brand text-white shadow-fab md:hidden dark:bg-brand-dark dark:text-ink"
    >
      <Plus className="size-6" strokeWidth={2.4} />
    </button>
  );
}

/* ─────────────────────────── Chip ─────────────────────────── */
const CHIP = {
  brand: "bg-brand-soft text-brand dark:bg-brand-pill-dark dark:text-brand-ink-dark",
  done: "bg-done-soft text-done-text dark:bg-done-fill-dark dark:text-done-dark",
  danger: "bg-danger-soft text-danger dark:bg-danger-fill-dark dark:text-danger-dark",
  neutral:
    "bg-surface text-ink-2 border border-line dark:bg-card-dark dark:text-ink-2-dark dark:border-line-dark",
} as const;

export function Chip({
  tone = "brand",
  children,
}: {
  tone?: keyof typeof CHIP;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-full px-2 py-[3px] text-[10px] font-bold",
        CHIP[tone],
      )}
    >
      {children}
    </span>
  );
}

/* Segmented filter — pills, never a select. Bottom spacing is left to the host
 * so the Actions screen can sit an inline filter input beside it. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={cn(
              "rounded-full px-3.5 py-[7px] text-xs",
              on
                ? "bg-brand font-bold text-white dark:bg-brand-dark dark:text-ink"
                : "border border-line bg-card font-semibold text-ink-2 dark:border-line-2-dark dark:bg-card-dark dark:text-ink-2-dark",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Group header above a run of rows. */
export function GroupHeader({
  label,
  count,
  muted,
}: {
  label: ReactNode;
  count?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-1.5">
      <span
        className={cn(
          "text-xs font-extrabold",
          muted ? "text-ink-4 dark:text-ink-4-dark" : "text-brand dark:text-brand-ink-dark",
        )}
      >
        {label}
      </span>
      {count != null && (
        <span className="mono text-[10px] text-ink-4 dark:text-ink-4-dark">{count}</span>
      )}
    </div>
  );
}

/* List wrapper — always flex + gap, never margins between rows. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-[9px]">{children}</ul>;
}

/* Panel — a titled section card. Danger tone gives a crimson border + heading. */
export function Panel({
  title,
  description,
  tone,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  tone?: "danger";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-panel bg-card p-4 shadow-card dark:bg-card-dark dark:shadow-none",
        tone === "danger" ? "border border-danger" : "dark:border dark:border-line-dark",
        className,
      )}
    >
      {title && (
        <h2
          className={cn(
            "text-[17px] font-extrabold tracking-[-0.02em]",
            tone === "danger" ? "text-danger" : "text-ink dark:text-ink-dark",
          )}
        >
          {title}
        </h2>
      )}
      {description && (
        <p className="text-xs leading-relaxed font-medium text-ink-3 dark:text-ink-4-dark">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

const BTN = {
  primary: "bg-brand text-white font-bold dark:bg-brand-dark dark:text-ink",
  secondary:
    "bg-brand-soft text-brand font-bold dark:bg-brand-pill-dark dark:text-brand-ink-dark",
  ghost: "border border-line-2 text-ink-2 font-semibold dark:border-line-2-dark dark:text-ink-2-dark",
  danger: "bg-danger text-white font-bold",
} as const;

export function Button({
  variant = "primary",
  full,
  className,
  children,
  ...rest
}: {
  variant?: keyof typeof BTN;
  full?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-control px-4 py-3 text-sm disabled:opacity-50",
        BTN[variant],
        full && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* Field — a labelled control. The label wraps the control, so clicking it
 * focuses; `hint` and `error` are mutually exclusive and the error wins. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{label}</span>
      {children}
      {hint && !error && <span className="text-[11px] font-medium text-ink-4">{hint}</span>}
      {error && (
        <span className="text-xs font-medium text-danger dark:text-danger-dark">{error}</span>
      )}
    </label>
  );
}

/* Progress meter — projects, usage, quotas. Turns danger above 90%. */
export function Meter({ value, max = 100, height = 6 }: { value: number; max?: number; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      style={{ height }}
      className="w-full overflow-hidden rounded-full bg-line dark:bg-line-dark"
    >
      <div
        style={{ width: `${pct}%`, height }}
        className={cn("rounded-full", pct >= 90 ? "bg-danger" : "bg-brand dark:bg-brand-dark")}
      />
    </div>
  );
}

/* Toggle — 44×26 track, brand on / line off, a 20px white knob. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[26px] w-11 flex-none items-center rounded-full p-[3px] transition-colors disabled:opacity-50",
        checked ? "justify-end bg-brand dark:bg-brand-dark" : "justify-start bg-line dark:bg-line-2-dark",
      )}
    >
      <span className="size-5 rounded-full bg-white" />
    </button>
  );
}

/* Undo toast — 5s. On mobile it's a full-width card stuck above the tab bar; on
 * desktop it pops in at the top-right. Used by optimistic delete. */
export function UndoToast({
  message,
  undoLabel,
  onUndo,
}: {
  message: ReactNode;
  undoLabel: ReactNode;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        "fixed z-50 flex items-center justify-between gap-3 border border-line bg-card text-foreground shadow-elevated motion-safe:animate-[fadeIn_160ms_ease-out] dark:border-line-dark",
        // Mobile: a big bar across the bottom, above the tab bar.
        "right-4 bottom-[86px] left-4 min-h-[72px] rounded-panel px-6 py-6",
        // Desktop: a card that pops in at the top-right.
        "md:top-5 md:right-5 md:bottom-auto md:left-auto md:min-h-0 md:min-w-[380px] md:rounded-panel md:px-6 md:py-5",
      )}
    >
      <span className="text-base font-semibold">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-control px-3 py-1.5 text-base font-extrabold text-brand hover:bg-brand-soft dark:text-brand-ink-dark dark:hover:bg-brand-pill-dark"
      >
        {undoLabel}
      </button>
    </div>
  );
}

/* Empty state — one sentence + one optional button, no illustration. */
export function EmptyState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3.5 py-8">
      <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{message}</p>
      {action}
    </div>
  );
}

/* Due date chip: mono, neutral normally, danger tone when overdue. The label is
 * pre-formatted with Intl in the account's time zone by the caller. */
export function DueChip({ overdue, label }: { overdue?: boolean; label: string }) {
  return (
    <span
      className={cn(
        "mono inline-flex flex-none items-center rounded-full px-2 py-[3px] text-[10px]",
        overdue
          ? "bg-danger-soft text-danger dark:bg-danger-fill-dark dark:text-danger-dark"
          : "border border-line bg-surface text-ink-2 dark:border-line-dark dark:bg-card-dark dark:text-ink-2-dark",
      )}
    >
      {label}
    </span>
  );
}

/* Rendered between rows at the drop target while dragging. */
export function DropIndicator() {
  return (
    <li className="flex items-center gap-1.5 py-px" aria-hidden>
      <span className="size-[7px] rounded-full border-2 border-brand dark:border-brand-dark" />
      <span className="h-0.5 flex-1 rounded-full bg-brand dark:bg-brand-dark" />
    </li>
  );
}

/* Skeleton rows at the real row height — shown while a list loads, never a
 * spinner in the list area. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-[9px]">
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          className="h-[62px] rounded-card bg-line motion-safe:animate-pulse dark:bg-card-dark"
        />
      ))}
    </ul>
  );
}

// How far a sheet must be pulled down before letting go dismisses it.
const SHEET_DISMISS = 96;

/* Bottom sheet used for quick add and row actions. Escape closes and returns
 * focus to the trigger; focus is trapped while open; the backdrop is not a link.
 *
 * Rendered into document.body rather than in place. A `position: fixed` box is
 * only viewport-relative while no ancestor is transformed — and a swipeable row
 * carries a permanent translateX, which makes it the containing block for
 * anything fixed inside it. In place, the sheet was laid out against the card
 * and then clipped by its overflow-hidden, so it opened as a small panel that
 * scrolled inside the row. The portal takes it out of that subtree entirely,
 * which also holds for any transform or overflow added to a row later. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // How far the sheet has been pulled down, and whether a pull is in progress.
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  useEffect(() => {
    if (!open) return;
    // A sheet that was dragged part-way and then reopened must not come back
    // still displaced.
    setDy(0);
    // Freeze the page underneath. Without this, dragging the sheet down — or
    // simply scrolling inside it once it has hit its end — scrolls the list
    // behind it instead, so the sheet appears to slide over a moving page.
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,button,select,textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = bodyOverflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  // The grabber promises the sheet can be pulled down, so it can be. The pull
  // only starts when the content is scrolled to the top: lower down, a downward
  // drag is someone scrolling back up through a long sheet, and stealing that
  // would make the content unreadable.
  // Every pointer event stops here. A portal still propagates through the React
  // tree, not the DOM one, so without this a drag on a sheet opened from a
  // swipeable row would also reach that row's gesture handlers — pulling the
  // sheet down would fire a swipe on the card behind it.
  function onPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (e.pointerType !== "touch") return;
    if ((ref.current?.scrollTop ?? 0) > 0) return;
    startY.current = e.clientY;
    pulling.current = true;
  }

  function onPointerMove(e: PointerEvent) {
    e.stopPropagation();
    if (!pulling.current || e.pointerType !== "touch") return;
    const moved = e.clientY - startY.current;
    // Downward only. Dragging up is the scroll the content expects.
    if (moved <= 0) {
      setDy(0);
      return;
    }
    if (!dragging && moved > 8) setDragging(true);
    setDy(moved);
  }

  function endPull(e: PointerEvent) {
    e.stopPropagation();
    pulling.current = false;
    setDragging(false);
    // Past the threshold it closes; short of it, it springs back rather than
    // sitting half-open.
    if (dy > SHEET_DISMISS) onClose();
    else setDy(0);
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-[rgb(20_22_31_/_0.4)] motion-safe:animate-[fadeIn_160ms_ease-out]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPull}
        onPointerCancel={endPull}
        className="relative max-h-[85dvh] touch-pan-y overflow-auto rounded-t-sheet bg-card px-4 pt-3.5 pb-5 shadow-sheet motion-safe:animate-[sheetUp_240ms_cubic-bezier(0.32,0.72,0,1)] dark:bg-card-dark"
        style={{
          // Unset at rest, like the swipe rows: an identity transform would
          // make this the containing block for anything fixed inside it.
          transform: dy === 0 ? undefined : `translateY(${dy}px)`,
          transition: dragging ? "none" : "transform 200ms",
          // Once a pull is under way the sheet must not also try to scroll its
          // own content: the finger is moving the whole sheet, not the text.
          touchAction: dragging ? "none" : undefined,
        }}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-2 dark:bg-line-2-dark" />
        <h2 className="mb-2 text-[17px] font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* DataTable — one definition rendered two ways: cards on mobile, a table from
 * 768px up. Sorting is the caller's business; `sorted` only marks the column the
 * rows already arrive in. */
export interface Column<Row> {
  key: string;
  label: ReactNode;
  align?: "right";
  /** Numerals, IDs and timestamps set in the mono face. */
  mono?: boolean;
  /** Set when the rows already arrive ordered by this column. */
  sorted?: "asc" | "desc";
  /** Given, the header becomes a button that asks for this column's order. */
  onSort?: () => void;
  render?: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  renderCard,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  renderCard: (row: Row) => ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-[9px] md:hidden">{rows.map(renderCard)}</div>
      <div className="hidden rounded-panel bg-card px-5 pt-1.5 pb-3.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line dark:border-line-dark">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    c.sorted === "asc"
                      ? "ascending"
                      : c.sorted === "desc"
                        ? "descending"
                        : undefined
                  }
                  className={cn(
                    "mono-label py-3",
                    c.align === "right" ? "text-right" : "text-left",
                    c.sorted && "text-brand dark:text-brand-ink-dark",
                  )}
                >
                  {c.onSort ? (
                    <button
                      type="button"
                      onClick={c.onSort}
                      className={cn(
                        "mono-label inline-flex items-center gap-1 hover:text-ink-2 dark:hover:text-ink-2-dark",
                        c.sorted && "text-brand dark:text-brand-ink-dark",
                      )}
                    >
                      {c.label}
                      {/* The arrow is the whole state: no third icon for
                          "sortable but not sorted", which only adds noise. */}
                      {c.sorted === "asc" ? " ↑" : c.sorted === "desc" ? " ↓" : ""}
                    </button>
                  ) : (
                    <>
                      {c.label}
                      {c.sorted === "asc" ? " ↑" : c.sorted === "desc" ? " ↓" : ""}
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-line-3 last:border-0 dark:border-line-dark"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "py-2.5 text-[13px] font-medium text-ink dark:text-ink-dark",
                      c.align === "right" && "text-right",
                      c.mono && "mono",
                    )}
                  >
                    {c.render?.(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* Per-route inner shell: full-bleed header on mobile / rounded panel on desktop,
 * then a scroll area that reserves space for the FAB (pb-[126px]) so the last
 * row never sits under it. The persistent sidebar + tab bar live in Layout. */
export function Screen({
  header,
  fab,
  children,
}: {
  header: ReactNode;
  fab?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/* At ≥1280px the content column caps at 1180px and centres. */}
      <div className="mx-auto flex w-full min-w-0 flex-1 flex-col xl:max-w-[1180px]">
        <div className="md:p-6 md:pb-0">{header}</div>
        <main
          className={cn(
            "flex-1 px-4 pt-4 md:px-6 md:pt-5 md:pb-8",
            fab ? "pb-[126px]" : "pb-[74px]",
          )}
        >
          {children}
        </main>
      </div>
      {fab}
    </>
  );
}
