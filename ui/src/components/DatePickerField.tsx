import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { today } from "@/lib/actionDates";
import { useDateFmt } from "@/lib/datefmt";
import { useLocale, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const FIRST_YEAR = 1900;

function parts(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return { year, month: month - 1, date };
}

function dayKey(year: number, month: number, date: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function validDay(value: string, max?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || (max && value > max)) return false;
  const { year, month, date } = parts(value);
  return dayKey(year, month, date) === value;
}

/**
 * An optional date with an explicit commit boundary.
 *
 * iOS's native empty date wheel selects today while it is merely being opened,
 * so binding an optional field directly to <input type="date"> makes an
 * accidental tap indistinguishable from a deliberate choice. This calendar
 * keeps its selection private until Apply; Cancel, the close button and the
 * backdrop all leave the form value alone.
 */
type DatePickerFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  max?: string;
  disabled?: boolean;
  className?: string;
};

export function DatePickerField(props: DatePickerFieldProps) {
  return <DatePickerFieldValue key={props.value} {...props} />;
}

function DatePickerFieldValue({
  id,
  value,
  onChange,
  label,
  max,
  disabled = false,
  className,
}: DatePickerFieldProps) {
  const t = useT();
  const { locale } = useLocale();
  const fmt = useDateFmt();
  const todayKey = today(fmt.dayKey);
  const initial = value || (max && max < todayKey ? max : todayKey);
  const initialParts = parts(initial);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [draft, setDraft] = useState(initial);
  const [year, setYear] = useState(initialParts.year);
  const [month, setMonth] = useState(initialParts.month);

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
          new Date(Date.UTC(2020, i, 1)),
        ),
      ),
    [locale],
  );
  const weekdayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(
          new Date(Date.UTC(2020, 5, 7 + i)),
        ),
      ),
    [locale],
  );
  const lastYear = Math.max(2100, Number(max?.slice(0, 4) || 0), initialParts.year);
  const years = useMemo(
    () => Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i),
    [lastYear],
  );

  const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const maxMonth = max?.slice(0, 7);

  function show(nextYear: number, nextMonth: number) {
    const at = new Date(Date.UTC(nextYear, nextMonth, 1));
    setYear(at.getUTCFullYear());
    setMonth(at.getUTCMonth());
  }

  function begin() {
    const next = value || (max && max < todayKey ? max : todayKey);
    const at = parts(next);
    setDraft(next);
    setYear(at.year);
    setMonth(at.month);
    setOpen(true);
  }

  function commitText() {
    // Keep the stored value canonical, but accept the slash separator people
    // can now type from the ordinary iOS keyboard as well as the shown hyphen.
    const next = text.trim().replaceAll("/", "-");
    if (next === value) return;
    if (!next) onChange("");
    else if (validDay(next, max)) {
      setText(next);
      onChange(next);
    }
    else setText(value);
  }

  return (
    <>
      <div className={cn("relative", className)}>
        <input
          id={id}
          type="text"
          // A date needs separators. iOS's numeric keyboard offers digits but
          // no slash or hyphen, making this editable field impossible to fill.
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          placeholder="YYYY-MM-DD"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onClick={begin}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commitText();
          }}
          className={cn(inputClass, "pr-9 disabled:cursor-not-allowed disabled:opacity-50")}
        />
        <CalendarDays className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-4" />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          overlayClassName="bg-black/35 backdrop-blur-[2px]"
          className={cn(
            "inset-auto top-1/2 left-1/2 h-auto max-h-[calc(100dvh-2rem)]",
            "w-[calc(100vw-2rem)] max-w-[22rem] -translate-x-1/2 -translate-y-1/2",
            "overflow-y-auto rounded-[24px] border-line bg-card p-4 shadow-sheet zoom-in-95",
            "dark:border-line-dark dark:bg-card-dark",
          )}
        >
          <DialogHeader className="pr-8 text-center">
            <DialogTitle className="text-[17px] font-extrabold">{label}</DialogTitle>
          </DialogHeader>

          <div className="mt-4 rounded-[18px] border border-line bg-surface p-3 dark:border-line-dark dark:bg-surface-dark">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("dates.previousMonth")}
                onClick={() => show(year, month - 1)}
                className="grid size-9 shrink-0 place-items-center rounded-full text-brand hover:bg-brand-soft dark:text-brand-ink-dark"
              >
                <ChevronLeft />
              </button>
              <select
                aria-label={t("dates.month")}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={cn(inputClass, "min-w-0 flex-1 border-0 bg-card px-2 font-bold")}
              >
                {monthNames.map((name, i) => (
                  <option key={name} value={i} disabled={Boolean(maxMonth && `${year}-${String(i + 1).padStart(2, "0")}` > maxMonth)}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("dates.year")}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={cn(inputClass, "w-24 border-0 bg-card px-2 font-bold")}
              >
                {years.map((option) => (
                  <option key={option} value={option} disabled={Boolean(max && option > Number(max.slice(0, 4)))}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={t("dates.calendarNextMonth")}
                disabled={Boolean(maxMonth && monthKey >= maxMonth)}
                onClick={() => show(year, month + 1)}
                className="grid size-9 shrink-0 place-items-center rounded-full text-brand hover:bg-brand-soft disabled:opacity-40 dark:text-brand-ink-dark"
              >
                <ChevronRight />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center">
              {weekdayNames.map((name, i) => (
                <span key={`${name}-${i}`} className="py-1 text-xs font-bold text-ink-4">
                  {name}
                </span>
              ))}
              {Array.from({ length: leading }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = i + 1;
                const key = dayKey(year, month, date);
                const selected = key === draft;
                const isToday = key === todayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={selected}
                    disabled={Boolean(max && key > max)}
                    onClick={() => setDraft(key)}
                    className={cn(
                      "aspect-square rounded-full text-sm font-semibold hover:bg-brand-soft disabled:text-ink-4 disabled:opacity-40",
                      isToday && !selected && "ring-1 ring-brand text-brand dark:text-brand-ink-dark",
                      selected && "bg-brand text-white hover:bg-brand",
                    )}
                  >
                    {date}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="mt-4 border-t border-line pt-3 dark:border-line-dark">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                onChange(draft);
                setText(draft);
                setOpen(false);
              }}
            >
              {t("common.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
