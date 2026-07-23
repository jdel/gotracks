import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale, useT } from "@/lib/i18n";
import { useServerConfig } from "@/hooks/useSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RegisterPage() {
  const { register } = useAuth();
  const t = useT();
  // The language is chosen on the sign-in page (it persists on the device), and
  // travels with the signup so the account starts in it.
  const { locale } = useLocale();
  const { data: config } = useServerConfig();
  const [email, setEmail] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(email, locale, bootstrapSecret || undefined);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.registerFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t("auth.createAccount")}</CardTitle>
        </CardHeader>
        <CardContent>
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
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {config?.bootstrapRequired && (
                <div className="space-y-2">
                  <Label htmlFor="bootstrap-secret">{t("auth.bootstrapSecret")}</Label>
                  <Input
                    id="bootstrap-secret"
                    type="password"
                    autoComplete="off"
                    value={bootstrapSecret}
                    onChange={(e) => setBootstrapSecret(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("auth.bootstrapSecretHelp")}</p>
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={busy || !email.trim() || Boolean(config?.bootstrapRequired && !bootstrapSecret)}
              >
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
        </CardContent>
      </Card>
    </div>
  );
}
