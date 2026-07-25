import { Link } from "react-router-dom";
import { useT } from "@/lib/i18n";

/**
 * The agreement tick shown where an account is created.
 *
 * One box covering all three documents rather than three: the terms are the
 * contract, and the privacy and cookie policies are things the reader is
 * informed of rather than asked to consent to. Splitting them implied a choice
 * that does not exist.
 */
export function LegalConsent({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useT();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0"
        checked={accepted}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {t("legal.consent.prefix")}{" "}
        <Link to="/terms" target="_blank" className="underline underline-offset-4">
          {t("legal.terms.short")}
        </Link>
        {", "}
        <Link to="/privacy" target="_blank" className="underline underline-offset-4">
          {t("legal.privacy.short")}
        </Link>
        {" & "}
        <Link to="/cookies" target="_blank" className="underline underline-offset-4">
          {t("legal.storage.short")}
        </Link>
        {". "}
        {t("legal.consent.mayChange")}
      </span>
    </label>
  );
}
