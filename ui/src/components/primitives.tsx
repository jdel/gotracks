import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type Ref,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { usePullToDismiss } from "@/hooks/usePullToDismiss";
import { SHEET_ENTER_MS, prefersReducedMotion } from "@/lib/motion";
import { Dialog, DialogTitle, FormScreenSurface, SheetSurface } from "@/components/ui/dialog";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { inputClass } from "@/components/primitive-styles";
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
  avatarLabel,
}: {
  title: ReactNode;
  metrics?: Metric[];
  back?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
  avatar?: ReactNode;
  /** Accessible name for the avatar link. Already translated, like everything
   *  else a caller hands this file. */
  avatarLabel?: string;
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
          // The initials are the only account affordance on a phone, so they
          // are the way into Settings rather than decoration.
          <Link
            to="/settings"
            aria-label={avatarLabel}
            className="flex size-[26px] items-center justify-center rounded-full bg-white/[0.18] text-[10px] font-extrabold transition-colors hover:bg-white/30"
          >
            {avatar}
          </Link>
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
    // Right-aligned, including the second line once the pills wrap: `ml-auto`
    // on the caller only moves the box, and a box that fills the row leaves its
    // wrapped pills hanging on the left.
    <div className={cn("flex flex-wrap justify-end gap-1.5", className)}>
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
  // Bordered. Secondary actions that still have to read as buttons: Cancel
  // beside a destructive confirm, "Export my data", the quick-add chevron.
  ghost: "border-line-2 text-ink-2 font-semibold dark:border-line-2-dark dark:text-ink-2-dark",
  // Borderless, tinting only on hover. For controls that live inside something
  // that already draws an edge — a card's row icons, the clear button inside a
  // date field — where a second box is a box inside a box. Deliberately not
  // called "ghost": the shadcn layer this replaces used that name for exactly
  // the opposite thing, and one word meaning two things is what made the two
  // button systems dangerous to merge.
  quiet:
    "text-ink-3 font-semibold hover:bg-brand-soft hover:text-brand dark:text-ink-4-dark dark:hover:bg-brand-pill-dark dark:hover:text-brand-ink-dark",
  danger: "bg-danger text-white font-bold",
} as const;

const BTN_SIZE = {
  // 36px and a 10px radius, which is exactly what the text fields beside them
  // are: the Save in the add bar sits next to the composer, the buttons in a
  // form sit under its inputs, and a button standing 8px taller than the field
  // it belongs to reads as a mistake. This is below the 44px touch guideline —
  // a deliberate call, taken because the alternative looks wrong on every
  // screen the buttons actually appear on.
  md: "h-9 gap-2 rounded-[10px] px-4 text-sm",
  // Compact controls: the weekday picker, a Cancel inside an editing row.
  sm: "h-8 gap-1.5 rounded-[10px] px-3 text-xs",
  // Square, and the same 36px as the default — the shape, not a floor: icon
  // buttons shrink further at their call sites (`size-7` in a list row).
  icon: "size-9 rounded-[10px]",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  full,
  className,
  children,
  asChild = false,
  type = "button",
  ...rest
}: {
  variant?: keyof typeof BTN;
  size?: keyof typeof BTN_SIZE;
  full?: boolean;
  /** Render as the child element — a Link that should look like a button. */
  asChild?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      // A bare <button> inside a <form> submits it. That default has caught
      // this app out: the clear-date button in the action editor submitted the
      // form, which saves and closes the sheet, so tapping it looked like the
      // drawer dismissing itself. Every button that really does submit says so;
      // the rest do not want it. asChild renders somebody else's element, which
      // may not be a button at all.
      {...(asChild ? {} : { type })}
      {...rest}
      className={cn(
        "inline-flex items-center justify-center border border-transparent transition-colors",
        // Icons inherit one size unless a call site says otherwise, and never
        // shrink when the label is long.
        "[&_svg]:size-4 [&_svg]:shrink-0",
        "focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        BTN_SIZE[size],
        BTN[variant],
        full && "w-full",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

/* Input — the one text field. A thin wrapper over <input> wearing the shared
 * class, so a caller writes <Input /> rather than remembering `inputClass`, and
 * a raw <input className={inputClass}> stays legitimate where the element needs
 * to be something else (a select, a textarea). */
export function Input({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} {...rest} className={cn(inputClass, className)} />;
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

/**
 * A form that takes the whole screen on a phone.
 *
 * The add and edit forms outgrew the bottom sheet. A sheet is anchored to the
 * bottom, which is precisely where a phone puts its keyboard: every field below
 * the one being typed into goes behind it, the panel has to be measured and
 * lifted, and focusing anything while it is still sliding up leaves the browser
 * scrolling to where the field used to be. Four separate fixes went into that
 * arrangement before it was worth admitting the container was wrong.
 *
 * Full screen has none of it. The first field is at the top, the keyboard
 * covers the bottom of a body that scrolls, and that is the most ordinary
 * behaviour there is. The short panels — defer, attachments, filters — stay
 * sheets, because two or three controls is what a sheet is for.
 */
export function FormScreen({
  open,
  onClose,
  title,
  closeLabel,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Already translated, like every other string this file is handed. */
  closeLabel: string;
  /** Icon buttons for the title row, to the left of the close button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const focusRefresh = useRef<number | undefined>(undefined);
  const focusReturn = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(
    () => () => {
      if (focusRefresh.current !== undefined) clearTimeout(focusRefresh.current);
      if (focusReturn.current !== undefined) cancelAnimationFrame(focusReturn.current);
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <FormScreenSurface
        ref={surface}
        tabIndex={-1}
        aria-describedby={undefined}
        // The same reasoning as the sheet's: a portal propagates through the
        // React tree, not the DOM one, so without this a drag inside the panel
        // reaches the swipeable row it was opened from.
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onPointerCancel={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // The description is the first field in these forms, regardless of
          // title-row actions. iOS can build the keyboard toolbar before a
          // newly portalled form has settled: the caret is right, but Next is
          // disabled until the user visits another field and returns. Preserve
          // the immediate focus that raises the keyboard, then reproduce that
          // proven sequence after the keyboard has arrived. This stays inside
          // the form (never Star, Delete or Close), prevents scrolling, and is
          // abandoned if the user has moved or started typing in the meantime.
          e.preventDefault();
          const primary = surface.current?.querySelector<HTMLInputElement>("[data-form-primary]");
          const initialValue = primary?.value;
          primary?.focus({ preventScroll: true });
          if (!primary) return;

          const ua = navigator.userAgent;
          const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
          if (!ios) return;

          focusRefresh.current = window.setTimeout(() => {
            focusRefresh.current = undefined;
            if (
              document.activeElement !== primary ||
              primary.value !== initialValue ||
              !surface.current?.contains(primary)
            ) return;
            const next = Array.from(primary.form?.elements ?? []).find(
              (control): control is HTMLInputElement =>
                control instanceof HTMLInputElement && control !== primary && !control.disabled,
            );
            if (!next) return;
            next.focus({ preventScroll: true });
            focusReturn.current = requestAnimationFrame(() => {
              focusReturn.current = undefined;
              if (document.activeElement === next && surface.current?.contains(primary)) {
                primary.focus({ preventScroll: true });
              }
            });
          }, 350);
        }}
      >
        {/* Sticky, so the way out is reachable from anywhere in a long form. */}
        <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 border-b border-line bg-card px-4 pt-1 pb-3 dark:border-line-dark dark:bg-card-dark">
          <DialogTitle className="min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
            {title}
          </DialogTitle>
          {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-ink-4 hover:bg-surface dark:hover:bg-line-dark"
          >
            <X className="size-4" />
          </button>
        </div>
        <div>{children}</div>
      </FormScreenSurface>
    </Dialog>
  );
}

/* Bottom sheet used for quick add, row actions and the mobile navigation.
 *
 * Built on the same dialog primitive as the modals, which is what supplies the
 * focus trap, the escape handling, the aria wiring and the scroll lock on the
 * page behind. An earlier hand-rolled version of this only moved focus into the
 * sheet and claimed to trap it — Tab walked straight back out to the page
 * underneath.
 *
 * The pull-to-dismiss gesture starts on the header, never on the body: the body
 * scrolls, so a browser that reads a downward drag there as a scroll takes the
 * gesture and the sheet would follow the finger a few pixels and snap back. */
export function Sheet({
  open,
  onClose,
  title,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Icon buttons for the title row, pinned to its right. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pull = usePullToDismiss(onClose);
  const { reset } = pull;
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A sheet that was dragged part-way and then reopened must not come back
    // still displaced.
    if (open) reset();
  }, [open, reset]);

  // Escape closes, explicitly. The dialog primitive offers this, but an icon
  // button carries a tooltip, and a focused tooltip swallows the key before the
  // dialog sees it — so the sheet's own title-row buttons could leave Escape
  // doing nothing at all.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <SheetSurface
        aria-describedby={undefined}
        onOverlayClick={onClose}
        // Every pointer event stops at the sheet. A portal propagates through
        // the React tree rather than the DOM one, so without this a swipe
        // inside a sheet opened from a swipeable row reaches that row's gesture
        // handlers underneath: dragging across the editor starred the action,
        // or threw the defer sheet on top of it.
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onPointerCancel={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        // The dialog's own "did that interaction land outside?" heuristic is
        // refused. It misjudges a sheet: a native select or date picker, and a
        // pointer captured by the swipeable row underneath, both retarget the
        // event away from the panel, and the sheet then dismisses itself under
        // a tap that was plainly inside it. Dismissal here is only ever the
        // backdrop, Escape, the pull, or the sheet's own buttons — all of them
        // explicit, none of them a guess.
        onInteractOutside={(e) => e.preventDefault()}
        style={pull.style}
        className="motion-safe:animate-[sheetUp_240ms_cubic-bezier(0.32,0.72,0,1)]"
        onOpenAutoFocus={(e) => {
          // Focus the first control of the sheet's content, not the title row:
          // opening a sheet on its delete button is startling, and it is the
          // field below that the sheet was opened to reach.
          e.preventDefault();
          // But only once the sheet has arrived. Focusing raises the keyboard,
          // and a keyboard raised while the sheet is still sliding up leaves
          // the browser scrolling to where the field was a frame ago — which is
          // how the description ended up off the top of the screen. Waiting for
          // the animation costs a quarter of a second and means the keyboard
          // opens against a sheet that is already where it will stay.
          const focusFirst = () => {
            const first = body.current?.querySelector<HTMLElement>(
              "input,button,select,textarea,[tabindex]:not([tabindex='-1'])",
            );
            first?.focus();
            // And if the browser still scrolled somewhere unhelpful, correct it
            // to the least it can do — no jump when it was already visible.
            // Guarded: jsdom implements no layout and so has no scrolling.
            first?.scrollIntoView?.({ block: "nearest" });
          };
          if (prefersReducedMotion()) {
            focusFirst();
            return;
          }
          setTimeout(focusFirst, SHEET_ENTER_MS);
        }}
      >
        {/* The header is the grip: the pull starts here, where the handle
            invites it, so the scrolling body below keeps its own gesture. */}
        <div {...pull.dragHandleProps} className="cursor-grab active:cursor-grabbing">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-2 dark:bg-line-2-dark" />
          {/* The title takes one line and is cut off: a long action description
              would otherwise push the actions beside it off the row, or eat the
              top of a sheet that has little height to spare. */}
          <div className="mb-2 flex items-center gap-2">
            <DialogTitle className="min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
              {title}
            </DialogTitle>
            {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
          </div>
        </div>
        <div ref={body}>{children}</div>
      </SheetSurface>
    </Dialog>
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
