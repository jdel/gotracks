import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Fingerprint, ShieldCheck, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useForgotPassword, useServerConfig } from "@/hooks/useSettings";
import { isPasskeySupported } from "@/lib/passkeys";
import { availableLocales, useLocale, useT } from "@/lib/i18n";
import { Button, Input } from "@/components/primitives";
import { fieldLabel } from "@/components/primitive-styles";
import { AuthLayout } from "@/components/AuthLayout";
import type { TwoFactorChallenge } from "@/lib/types";

export function LoginPage() {
  const { login, completeTwoFactor, signInWithPasskey } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted but a second factor is still owed. Kept
  // in component state only — it must never be persisted.
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const forgot = useForgotPassword();
  const [forgotSent, setForgotSent] = useState(false);

  // The response is deliberately the same whether or not the address is
  // registered, so the confirmation here says "if" rather than "we sent".
  async function onForgot() {
    if (!email.trim()) {
      setError(t("auth.emailFirst"));
      return;
    }
    setError("");
    try {
      await forgot.mutateAsync({ email: email.trim() });
    } catch {
      // Deliberately ignored: the endpoint reveals nothing either way.
    }
    setForgotSent(true);
  }

  // The server decides which sign-in methods to offer.
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { data: config } = useServerConfig();

  // A passkey identifies the account, but the server still needs to know which
  // account to challenge, so the email field is used to look up its keys.
  async function onPasskey() {
    if (!email.trim()) {
      setError(t("auth.emailFirstPasskey"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      await signInWithPasskey(email.trim());
      navigate("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "passkey sign-in failed";
      // Cancelling the browser prompt should not look like a failure.
      setError(/NotAllowed|abort/i.test(message) ? "" : message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const pending = await login(email, password);
      if (pending) {
        // Password accepted, sign-in unfinished: move to the second step and
        // drop the password from state, it is no longer needed.
        setChallenge(pending);
        setPassword("");
        return;
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError("");
    setBusy(true);
    try {
      await completeTwoFactor(challenge.challengeId, code.trim());
      navigate("/");
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      // An expired or exhausted challenge cannot be retried: start over.
      if (apiErr?.status === 400) {
        backToPassword();
        setError(apiErr.message);
        return;
      }
      setError(apiErr ? apiErr.message : "verification failed");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setChallenge(null);
    setCode("");
    setUseRecovery(false);
    setError("");
  }

  return (
    <AuthLayout title={challenge ? t("auth.twoFactorTitle") : t("auth.signInTitle")}>
          {challenge ? (
            <form onSubmit={onVerify} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {useRecovery
                  ? t("auth.twoFactorRecoveryHelp")
                  : t("auth.twoFactorCodeHelp")}
              </p>
              <div className="space-y-2">
                <label htmlFor="code" className={fieldLabel}>{useRecovery ? t("auth.recoveryCode") : t("auth.code")}</label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode={useRecovery ? "text" : "numeric"}
                  placeholder={useRecovery ? "XXXX-XXXX-XXXX-XXXX" : "123456"}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || !code.trim()}>
                <ShieldCheck /> {busy ? t("auth.verifying") : t("auth.verify")}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-muted-foreground underline"
                  onClick={backToPassword}
                >
                  <ArrowLeft className="size-3" /> Back
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode("");
                    setError("");
                  }}
                >
                  {useRecovery ? t("auth.useAuthenticator") : t("auth.useRecoveryCode")}
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className={fieldLabel}>{t("auth.email")}</label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className={fieldLabel}>{t("auth.password")}</label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {forgotSent && (
              <p className="text-sm text-muted-foreground">
                If that address has an account, a reset link is on its way.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
            <p className="text-center text-sm">
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={onForgot}
                disabled={forgot.isPending}
              >
                {t("auth.forgotPassword")}
              </button>
            </p>
            {config?.passkeys && isPasskeySupported() && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={onPasskey}>
                <Fingerprint /> {t("auth.passkeySignIn")}
              </Button>
            )}
            {/* Sign-up is hidden when an admin has closed registration. */}
            {config?.allowRegister && (
              <p className="text-center text-sm text-muted-foreground">
                {t("auth.noAccount")}{" "}
                <Link to="/register" className="underline">
                  {t("auth.register")}
                </Link>
              </p>
            )}
            <div className="flex items-center justify-center gap-2">
              <label htmlFor="locale" className="text-xs text-muted-foreground">
                {t("settings.language")}
              </label>
              <select
                id="locale"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                {availableLocales.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>
          </form>
          )}
    </AuthLayout>
  );
}
