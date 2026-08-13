import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * A search field with a leading magnifier and a trailing clear button that
 * appears once there is something to clear. Clearing sends an empty string
 * through the same onChange, so any side effect the parent runs on a change
 * (resetting the page, say) happens on clear too.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Wrapper classes, for width/flex in a filter row. */
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="px-8"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      {value && (
        <IconButton
          type="button"
          className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
          label={t("common.clearSearch")}
          onClick={() => onChange("")}
        >
          <X className="size-4" />
        </IconButton>
      )}
    </div>
  );
}
