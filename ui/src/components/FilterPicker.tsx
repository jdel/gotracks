import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export interface PickerOption {
  /** "" is a legitimate value: it is how "no project" is chosen. */
  value: string;
  label: string;
}

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
  ariaLabel,
  filterLabel,
  noMatchLabel,
  className,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
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

  const selected = options.find((o) => o.value === value);

  function close() {
    setOpen(false);
    setFilter("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFilter("");
      }}
    >
      <PopoverAnchor asChild>
        <Input
          className={className}
          value={selected?.label ?? ""}
          readOnly
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          aria-label={ariaLabel}
        />
      </PopoverAnchor>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-1">
        <Input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${filterLabel}…`}
          aria-label={filterLabel}
        />
        <div className="mt-1 max-h-56 overflow-y-auto">
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              {o.label}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{noMatchLabel}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
