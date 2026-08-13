import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { KeyRound } from "lucide-react";
import { useAcceptInvitation, useResetPassword } from "@/hooks/useSettings";
import { ApiError } from "@/lib/api";
import { PasswordRules } from "@/components/PasswordRules";
import { isPasswordValid } from "@/lib/password";
import { Button } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { AuthLayout } from "@/components/AuthLayout";
import { LegalConsent } from "@/components/LegalConsent";
import { useServerConfig } from "@/hooks/useSettings";

/** Landing page for the link in a password-reset email. */
export function ResetPasswordPage() {
  return <PasswordFromMailPage invitation={false} />;
}

/** Landing page for an administrator-issued account invitation. */
export function AcceptInvitationPage() {
  return <PasswordFromMailPage invitation />;
}

function PasswordFromMailPage({ invitation }: { invitation: boolean }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();
  const accept = useAcceptInvitation();
  const navigate = useNavigate();
  const { establishSession } = useAuth();
  const t = useT();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Accepting an invitation is where an account is really created, so it is
  // where consent is captured. An instance with the pages off asks nothing.
  const { data: serverConfig } = useServerConfig();
  const consentRequired = invitation && serverConfig?.legal === true;
  const consentGiven = accepted;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("reset.errMismatch"));
      return;
    }
    try {
      if (invitation) {
        const response = await accept.mutateAsync({
          token,
          newPassword: password,
          acceptLegal: accepted,
        });
        establishSession(response);
        navigate("/", { replace: true });
        return;
      }
      await reset.mutateAsync({ token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("reset.errGeneric"));
    }
  }

  return (
    <AuthLayout title={t(invitation ? "invite.title" : "reset.title")}>
          {!token ? (
            <p className="text-sm text-destructive">
              {t(invitation ? "invite.incomplete" : "reset.incomplete")}
            </p>
          ) : done ? (
            <div className="space-y-4">
              <p className="text-sm">{t(invitation ? "invite.done" : "reset.done")}</p>
              <Button className="w-full" onClick={() => navigate("/login")}>
                {t("auth.signIn")}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">{t("password.new")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                <PasswordRules password={password} className="pt-1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t("password.confirm")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {consentRequired && (
                <LegalConsent accepted={accepted} onChange={setAccepted} />
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  reset.isPending ||
                  accept.isPending ||
                  !isPasswordValid(password) ||
                  !confirm ||
                  (consentRequired && !consentGiven)
                }>
                <KeyRound />
                {reset.isPending || accept.isPending
                  ? t("reset.saving")
                  : t(invitation ? "invite.accept" : "reset.setNew")}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="underline">
                  {t("reset.back")}
                </Link>
              </p>
            </form>
          )}
    </AuthLayout>
  );
}
