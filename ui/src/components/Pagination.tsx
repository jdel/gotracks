import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// 34px is the size the reference draws; the checklist wants a 44px target. Both
// are satisfiable at once — the pseudo-element extends the hit area 5px on every
// side without changing what is painted. `relative` is what anchors it.
const pageBtn =
  "relative flex size-[34px] items-center justify-center rounded-[10px] disabled:opacity-40 [&_svg]:size-4 " +
  "before:absolute before:-inset-[5px] before:content-['']";

/** Page controls shared by the admin list and the usage report. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-2 pt-4">
      <span className="mono text-[11px] text-ink-4">
        {t("pagination.range", { first, last, total })}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t("pagination.prev")}
          className={cn(pageBtn, "border border-line-2 text-ink-4 dark:border-line-2-dark")}
        >
          <ChevronLeft />
        </button>
        <span className="mono text-[11px] text-ink-3 dark:text-ink-4-dark">
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t("pagination.next")}
          className={cn(pageBtn, "bg-brand font-bold text-white dark:bg-brand-dark dark:text-ink")}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
