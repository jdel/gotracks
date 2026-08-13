import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button, Input } from "@/components/primitives";
import { fieldLabel } from "@/components/primitive-styles";
import { useLocale, useT } from "@/lib/i18n";
import { AuthLayout } from "@/components/AuthLayout";

export function RegisterPage() {
  const { register } = useAuth();
  const t = useT();
  // The language is chosen on the sign-in page (it persists on the device), and
  // travels with the signup so the account starts in it.
  const { locale } = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(email, locale);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.registerFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t("auth.createAccount")}>
          {sent ? (
            <div className="space-y-4">
              <p className="text-sm">{t("auth.enrollmentSent")}</p>
              <Button asChild className="w-full">
                <Link to="/login">{t("auth.signIn")}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className={fieldLabel}>{t("auth.email")}</label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !email.trim()}>
                {busy ? t("auth.creating") : t("auth.createAccount")}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {t("auth.haveAccount")}{" "}
                <Link to="/login" className="underline">
                  {t("auth.signIn")}
                </Link>
              </p>
            </form>
          )}
    </AuthLayout>
  );
}
