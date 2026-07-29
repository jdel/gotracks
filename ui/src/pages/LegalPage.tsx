import { Link } from "react-router";
import { useLegalDocuments } from "@/hooks/useLegal";
import { useServerConfig } from "@/hooks/useSettings";
import { renderMarkdown } from "@/lib/markdown";
import { useT } from "@/lib/i18n";
import type { LegalKind } from "@/lib/types";

function LegalPage({ kind }: { kind: LegalKind }) {
  const t = useT();
  const { data, isPending } = useLegalDocuments();
  const body = data?.find((doc) => doc.kind === kind)?.body ?? "";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-10">
      {/* The title is the document's own first heading, so there is nothing to
          keep in sync between the text and the page around it. */}
      <article className="space-y-4 text-sm leading-relaxed">
        {isPending ? (
          <p className="text-muted-foreground">{t("legal.loading")}</p>
        ) : (
          renderMarkdown(body)
        )}
      </article>
      <p className="pt-8 text-sm">
        <Link to="/" className="underline underline-offset-4">
          {t("legal.back")}
        </Link>
      </p>
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
