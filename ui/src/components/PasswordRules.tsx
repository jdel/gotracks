import { Check, X } from "lucide-react";
import { passwordRules } from "@/lib/password";
import { cn } from "@/lib/utils";
import { useT, type TFunc } from "@/lib/i18n";

/**
 * PasswordRules shows the policy and ticks each rule off as it is met.
 *
 * Rendered live rather than only on submit, so the requirements are visible
 * before the user commits to a password rather than as a rejection afterwards.
 */
export function PasswordRules({ password, className }: { password: string; className?: string }) {
  const t = useT();
  const rules = passwordRules(password);
  const touched = password.length > 0;

  return (
    <ul className={cn("space-y-1", className)} aria-label={t("passwordRules.aria")}>
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={cn(
            "flex items-center gap-1.5 text-xs transition-colors",
            !touched && "text-muted-foreground",
            touched && rule.met && "text-emerald-600",
            touched && !rule.met && "text-muted-foreground",
          )}
        >
          {touched && rule.met ? (
            <Check className="size-3 shrink-0" aria-hidden />
          ) : (
            <X className={cn("size-3 shrink-0", !touched && "opacity-40")} aria-hidden />
          )}
          {/* Screen readers get the state in words; sighted users get the icon. */}
          <span className="sr-only">{touched && rule.met ? t("passwordRules.met") : t("passwordRules.notMet")}</span>
          {t(rule.labelKey as Parameters<TFunc>[0], rule.labelParams)}
        </li>
      ))}
    </ul>
  );
}
