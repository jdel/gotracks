import { useState } from "react";
import { useLegalEditor, useResetLegalDocument, useSaveLegalDocument } from "@/hooks/useLegal";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Button, Chip, HeaderBlock, Panel, Screen } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import { cn } from "@/lib/utils";
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
  const { user } = useAuth();
  const [locale, setLocale] = useState(availableLocales[0].code);
  const { data: editor } = useLegalEditor();

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("nav.legal")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
        />
      }
    >
      <div className="mt-4 flex flex-col gap-4">
        <label className="flex max-w-xs flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("legal.admin.language")}</span>
          <select
            id="legal-locale"
            className={inputClass}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            {availableLocales.map(({ code, label, flag }) => (
              <option key={code} value={code}>
                {flag} {label}
              </option>
            ))}
          </select>
        </label>

        {/* The editors seed their box from the loaded text once, so they must not
            mount before it arrives. */}
        {editor ? (
          kinds.map((kind) => (
            <DocumentEditor key={`${locale}-${kind}`} locale={locale} kind={kind} />
          ))
        ) : (
          <p className="text-sm font-medium text-ink-3">{t("legal.loading")}</p>
        )}
      </div>
    </Screen>
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
    <Panel>
      <div className="flex items-center justify-between">
        <Label htmlFor={`legal-${locale}-${kind}`} className="text-[17px] font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
          {t(labelKeys[kind])}
        </Label>
        <Chip tone="neutral">{customised ? t("legal.admin.customised") : t("legal.admin.shipped")}</Chip>
      </div>
      <textarea
        id={`legal-${locale}-${kind}`}
        // Markdown, so a monospace box that does not reflow the source.
        className={cn(inputClass, "h-auto min-h-[220px] py-3 font-mono")}
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
        {status && <span className="text-sm font-medium text-ink-3">{status}</span>}
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
    </Panel>
  );
}
