import { Link } from "react-router";
import { useLegalDocuments } from "@/hooks/useLegal";
import { useServerConfig } from "@/hooks/useSettings";
import { renderMarkdown } from "@/lib/markdown";
import { useT } from "@/lib/i18n";
import { Mark } from "@/components/primitives";
import type { LegalKind } from "@/lib/types";

// Typographic rules for the rendered markdown body — a single measure, mono for
// {{PLACEHOLDERS}}, brand links, pretty-wrapped body.
const PROSE =
  "flex flex-col gap-4 " +
  "[&_h1]:text-[28px] md:[&_h1]:text-[34px] [&_h1]:font-extrabold [&_h1]:tracking-[-0.04em] [&_h1]:text-ink dark:[&_h1]:text-ink-dark " +
  "[&_h2]:mt-6 [&_h2]:text-[17px] [&_h2]:font-extrabold [&_h2]:tracking-[-0.02em] [&_h2]:text-ink dark:[&_h2]:text-ink-dark " +
  "[&_p]:text-sm [&_p]:font-medium [&_p]:leading-[1.65] [&_p]:text-ink-2 dark:[&_p]:text-ink-2-dark [&_p]:[text-wrap:pretty] " +
  "[&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_li]:text-sm [&_li]:font-medium [&_li]:text-ink-2 dark:[&_li]:text-ink-2-dark " +
  "[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 dark:[&_a]:text-brand-ink-dark " +
  "[&_code]:font-mono [&_code]:text-ink dark:[&_code]:text-ink-dark";

function LegalPage({ kind }: { kind: LegalKind }) {
  const t = useT();
  const { data, isPending } = useLegalDocuments();
  const body = data?.find((doc) => doc.kind === kind)?.body ?? "";

  return (
    <div className="min-h-dvh bg-surface dark:bg-surface-dark">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5 dark:border-line-dark">
        <div className="flex items-center gap-1.5">
          <Mark size={20} className="bg-brand text-white dark:bg-brand-dark dark:text-ink" />
          <span className="text-base font-extrabold tracking-[-0.045em] text-ink dark:text-ink-dark">
            gotracks
          </span>
        </div>
        <Link to="/" className="text-xs font-bold text-brand dark:text-brand-ink-dark">
          {t("legal.back")}
        </Link>
      </div>
      <div className="mx-auto w-full max-w-[680px] px-5 py-8">
        <article className={PROSE}>
          {isPending ? (
            <p className="text-sm font-medium text-ink-3">{t("legal.loading")}</p>
          ) : (
            renderMarkdown(body)
          )}
        </article>
      </div>
    </div>
  );
}

export const TermsPage = () => <LegalPage kind="terms" />;
export const PrivacyPage = () => <LegalPage kind="privacy" />;
export const CookiesPage = () => <LegalPage kind="cookies" />;

/**
 * The footer links carried by the sign-in, registration and application pages.
 *
 * onNavigate lets a caller that renders these inside an overlay close it on the
 * way out — the mobile navigation sheet stays open across a route change
 * otherwise, leaving the document hidden behind it.
 */
export function LegalLinks({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useT();
  const { data: config } = useServerConfig();
  // Rendered only once the instance has confirmed it serves the pages, so a
  // deployment with them off never shows a link to a route that 404s.
  if (!config?.legal) return null;

  const links: Array<[string, string]> = [
    ["/terms", t("legal.terms.short")],
    ["/privacy", t("legal.privacy.short")],
    ["/cookies", t("legal.storage.short")],
  ];
  return (
    <nav className={className}>
      {links.map(([to, label], i) => (
        <span key={to}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <Link to={to} onClick={onNavigate} className="underline-offset-4 hover:underline">
            {label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
