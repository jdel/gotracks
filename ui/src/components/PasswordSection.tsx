import { useState, type FormEvent } from "react";
import { KeyRound, Fingerprint } from "lucide-react";
import { useChangePassword, usePasskeys, useServerConfig } from "@/hooks/useSettings";
import { isPasskeySupported, reauthWithPasskey } from "@/lib/passkeys";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordRules } from "@/components/PasswordRules";
import { isPasswordValid } from "@/lib/password";
import { useT } from "@/lib/i18n";

/**
 * PasswordSection lets a signed-in user change their own password.
 *
 * A change always needs fresh proof of identity — the current password, or a
 * passkey assertion — because being signed in is not the same as being the
 * account owner at the keyboard. Without it, a borrowed session could set a new
 * password and lock the owner out.
 */
export function PasswordSection() {
  const t = useT();
  const change = useChangePassword();
  const { data: config } = useServerConfig();
  const passkeysEnabled = config?.passkeys === true;
  const { data: passkeys } = usePasskeys(passkeysEnabled);
  // Offered only when there is a key to assert with, and the browser can do it.
  const canUsePasskey =
    passkeysEnabled && isPasskeySupported() && (passkeys?.length ?? 0) > 0;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busyPasskey, setBusyPasskey] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  /** Shared checks for both proofs. */
  function validate(): boolean {
    setError("");
    setDone(false);
    // Caught here rather than at the server, which only ever sees one of them.
    if (!next) {
      setError(t("password.errEnterNew"));
      return false;
    }
    if (next !== confirm) {
      setError(t("password.errMismatch"));
      return false;
    }
    if (!isPasswordValid(next)) {
      setError(t("password.errRequirements"));
      return false;
    }
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (next === current) {
      setError(t("password.errSame"));
      return;
    }

    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      reset();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("password.errGeneric"));
    }
  }

  // Proving presence with the authenticator instead of the old password, which
  // someone who signs in with a passkey may never have memorised.
  async function onPasskey() {
    if (!validate()) return;
    setBusyPasskey(true);
    try {
      const proof = await reauthWithPasskey();
      await change.mutateAsync({ newPassword: next, ...proof });
      reset();
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("password.errGeneric");
      // Dismissing the browser prompt is not a failure worth shouting about.
      setError(/NotAllowed|abort/i.test(message) ? "" : message);
    } finally {
      setBusyPasskey(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("password.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
<p className="text-sm text-muted-foreground">{t("password.signsOut")}</p>
          <div className="space-y-2">
            <Label htmlFor="current-password">
              {canUsePasskey ? t("password.currentOrPasskey") : t("password.current")}
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">{t("password.new")}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <PasswordRules password={next} className="pt-1" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t("password.confirm")}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {done && <p className="text-sm text-emerald-600">{t("password.changed")}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              disabled={change.isPending || busyPasskey || !current || !next || !confirm}
            >
              <KeyRound /> {change.isPending && !busyPasskey ? t("password.changing") : t("password.change")}
            </Button>
            {canUsePasskey && (
              <Button
                type="button"
                variant="outline"
                disabled={change.isPending || busyPasskey || !next || !confirm}
                onClick={onPasskey}
              >
                <Fingerprint /> {busyPasskey ? t("password.waitingPasskey") : t("password.confirmPasskey")}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
