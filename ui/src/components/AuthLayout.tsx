import type { ReactNode } from "react";
import { Mark } from "@/components/primitives";
import { LegalLinks } from "@/pages/LegalPage";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The shared shell for every unauthenticated page: a brand panel (a full-bleed
// header on mobile, the left 46% on desktop) and a card holding the form. The
// destructive variant (delete-account, and other final confirmations) swaps the
// brand for danger.
export function AuthLayout({
  title,
  danger,
  children,
}: {
  title: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const marketing = t("auth.marketing");
  const subMarketing = t("auth.subMarketing");
  return (
    <div className="flex min-h-dvh flex-col bg-surface md:flex-row dark:bg-surface-dark">
      <div
        className={cn(
          "flex flex-col px-5 pt-7 pb-11 text-white md:w-[46%] md:px-10 md:py-10",
          danger ? "bg-danger" : "bg-brand dark:bg-brand-header",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Mark size={20} className="bg-white text-brand dark:bg-brand-dark dark:text-ink" />
          <span className="text-base font-extrabold tracking-[-0.045em]">gotracks</span>
        </div>
        {marketing && (
          <p className="mt-6 max-w-[14ch] text-[25px] leading-[1.1] font-extrabold tracking-[-0.03em] md:mt-auto md:text-[40px]">
            {marketing}
          </p>
        )}
        {subMarketing && (
          <p className="mono mt-4 hidden text-[11px] text-white/70 md:block">{subMarketing}</p>
        )}
      </div>

      <div className="flex flex-1 flex-col md:items-center md:justify-center md:p-6">
        <div className="-mt-[30px] mx-4 flex flex-col gap-4 rounded-panel bg-card p-5 shadow-elevated md:mx-0 md:mt-0 md:w-[400px] md:p-6 dark:border dark:border-line-dark dark:bg-card-dark">
          <h2
            className={cn(
              "text-[17px] font-extrabold tracking-[-0.02em] md:text-[22px]",
              danger ? "text-danger" : "text-ink dark:text-ink-dark",
            )}
          >
            {title}
          </h2>
          {children}
        </div>
        <LegalLinks className="mt-6 pb-6 text-center text-[11px] font-medium text-ink-4 md:mt-auto" />
      </div>
    </div>
  );
}
