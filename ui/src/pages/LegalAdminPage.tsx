import { useState } from "react";
import { useLegalEditor, useResetLegalDocument, useSaveLegalDocument } from "@/hooks/useLegal";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiMessage } from "@/lib/api";
import { availableLocales, useT } from "@/lib/i18n";
import type { LegalKind } from "@/lib/types";

const kinds: LegalKind[] = ["terms", "privacy", "cookies"];

const labelKeys = {
  terms: "legal.terms.short",
  privacy: "legal.privacy.short",
  cookies: "legal.storage.short",
} as const;

/**
 * The operator's editor: a language at the top, then the three documents as
 * markdown. Saving publishes — readers see it on their next load.
 */
export function LegalAdminPage() {
  const t = useT();
  const [locale, setLocale] = useState(availableLocales[0].code);
  const { data: editor } = useLegalEditor();

  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.legal")}</h1>
        <p className="text-sm text-muted-foreground">{t("legal.admin.description")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="legal-locale">{t("legal.admin.language")}</Label>
        <select
          id="legal-locale"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          {availableLocales.map(({ code, label, flag }) => (
            <option key={code} value={code}>
              {flag} {label}
            </option>
          ))}
        </select>
      </div>

      {/* The editors seed their box from the loaded text once, so they must not
          mount before it arrives — a box seeded from an in-flight query stays
          empty for good. */}
      {editor ? (
        <div className="space-y-6">
          {kinds.map((kind) => (
            // Keyed by both, so switching language loads that language's text
            // rather than leaving the previous one in a stale editor.
            <DocumentEditor key={`${locale}-${kind}`} locale={locale} kind={kind} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("legal.loading")}</p>
      )}
    </PageContainer>
  );
}

function DocumentEditor({ locale, kind }: { locale: string; kind: LegalKind }) {
  const t = useT();
  const { data: editor } = useLegalEditor();
  const save = useSaveLegalDocument();
  const reset = useResetLegalDocument();

  const override = editor?.overrides?.[locale]?.[kind];
  const shipped = editor?.defaults?.[locale]?.[kind] ?? "";
  const [body, setBody] = useState(override ?? shipped);
  const [status, setStatus] = useState("");

  const customised = override !== undefined;
  const dirty = body !== (override ?? shipped);

  async function run(action: () => Promise<unknown>, done: string) {
    setStatus("");
    try {
      await action();
      setStatus(done);
    } catch (err) {
      setStatus(apiMessage(err, t("legal.admin.saveFailed")));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`legal-${locale}-${kind}`}>{t(labelKeys[kind])}</Label>
        <span className="text-xs text-muted-foreground">
          {customised ? t("legal.admin.customised") : t("legal.admin.shipped")}
        </span>
      </div>
      <textarea
        id={`legal-${locale}-${kind}`}
        // Markdown, so a monospace box that does not reflow the source.
        className="min-h-64 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
        spellCheck={false}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => run(() => save.mutateAsync({ locale, kind, body }), t("legal.admin.saved"))}
          disabled={save.isPending || !dirty}
        >
          {save.isPending ? t("legal.admin.saving") : t("legal.admin.save")}
        </Button>
        {status && <span className="text-sm text-muted-foreground">{status}</span>}
        {/* Pinned right and always present, so it keeps one place in the row.
            Restores the shipped text on the server and in the box at once. */}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            run(async () => {
              await reset.mutateAsync({ locale, kind });
              setBody(shipped);
            }, t("legal.admin.reset"))
          }
          disabled={reset.isPending || (!customised && body === shipped)}
        >
          {t("legal.admin.useShipped")}
        </Button>
      </div>
    </div>
  );
}
