import { useState } from "react";
import { ShieldCheck, ShieldOff, RefreshCw, Copy, Download } from "lucide-react";
import {
  useBeginEnrolment,
  useDisableTwoFactor,
  useFinishEnrolment,
  useRegenerateRecoveryCodes,
  useServerConfig,
  useTwoFactor,
} from "@/hooks/useSettings";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TwoFactorEnrolment } from "@/lib/types";
import { useT, useTn } from "@/lib/i18n";

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

// TwoFactorSection lets a user turn on an authenticator app for their own
// account. Opt-in per user: nothing changes for anyone who ignores it.
export function TwoFactorSection() {
  const t = useT();
  const tn = useTn();
  const { data: config } = useServerConfig();
  const available = config?.twoFactor === true;
  const { data: status, isLoading } = useTwoFactor(available);

  const begin = useBeginEnrolment();
  const finish = useFinishEnrolment();
  const regenerate = useRegenerateRecoveryCodes();
  const disable = useDisableTwoFactor();

  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  // Recovery codes are returned once and never again, so they stay on screen
  // until the user confirms they have saved them.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  if (!available) return null;

  function reset() {
    setEnrolment(null);
    setCode("");
    setPassword("");
    setDisableCode("");
    setShowDisable(false);
    setShowRegenerate(false);
    setError("");
  }

  async function onBegin() {
    setError("");
    try {
      setEnrolment(await begin.mutateAsync());
    } catch (err) {
      setError(message(err, t("twofactor.errBegin")));
    }
  }

  async function onFinish() {
    if (!enrolment) return;
    setError("");
    try {
      const res = await finish.mutateAsync({ enrolmentId: enrolment.enrolmentId, code: code.trim() });
      setRecoveryCodes(res.recoveryCodes);
      reset();
    } catch (err) {
      setError(message(err, t("twofactor.errEnable")));
      setCode("");
    }
  }

  async function onRegenerate() {
    setError("");
    try {
      const res = await regenerate.mutateAsync({ password });
      setRecoveryCodes(res.recoveryCodes);
      reset();
    } catch (err) {
      setError(message(err, t("twofactor.errRegen")));
    }
  }

  async function onDisable() {
    setError("");
    try {
      await disable.mutateAsync({ password, code: disableCode.trim() });
      reset();
    } catch (err) {
      setError(message(err, t("twofactor.errDisable")));
    }
  }

  function copyCodes() {
    if (recoveryCodes) void navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  function downloadCodes() {
    if (!recoveryCodes) return;
    const url = URL.createObjectURL(new Blob([recoveryCodes.join("\n")], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "gotracks-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Shown once, immediately after enrolment or regeneration.
  if (recoveryCodes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("twofactor.saveTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
<p className="text-sm text-muted-foreground">{t("twofactor.saveIntro")}</p>
          <ul className="grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
              <Copy /> {t("twofactor.copy")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadCodes}>
              <Download /> {t("twofactor.download")}
            </Button>
          </div>
          <Button type="button" className="w-full" onClick={() => setRecoveryCodes(null)}>
            {t("twofactor.saved")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("twofactor.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

        {!isLoading && !status?.enabled && !enrolment && (
          <>
<p className="text-sm text-muted-foreground">{t("twofactor.intro")}</p>
            <Button type="button" onClick={onBegin} disabled={begin.isPending}>
              <ShieldCheck /> {begin.isPending ? t("twofactor.preparing") : t("twofactor.setup")}
            </Button>
          </>
        )}

        {enrolment && (
          <div className="space-y-4">
<p className="text-sm text-muted-foreground">{t("twofactor.scan")}</p>
            <img src={enrolment.qr} alt={t("twofactor.qrAlt")} className="rounded-md border" />
            <p className="text-xs text-muted-foreground">
              {t("twofactor.cantScan")}{" "}
              <code className="break-all font-mono">{enrolment.secret}</code>
            </p>
            <div className="space-y-2">
              <Label htmlFor="totp">{t("twofactor.codeFromApp")}</Label>
              <Input
                id="totp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={onFinish} disabled={finish.isPending || !code.trim()}>
                {finish.isPending ? t("twofactor.verifying") : t("twofactor.turnOn")}
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {!isLoading && status?.enabled && !enrolment && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("twofactor.onSince", { date: status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : "—" })}{" "}
              {tn(status.recoveryCodesRemaining, "twofactor.codesLeft")}
            </p>

            {showRegenerate ? (
              <div className="space-y-2">
                <Label htmlFor="regen-password">{t("twofactor.confirmPassword")}</Label>
                <Input
                  id="regen-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
<p className="text-xs text-muted-foreground">{t("twofactor.replaceWarn")}</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={onRegenerate} disabled={regenerate.isPending}>
                    {regenerate.isPending ? t("common.working") : t("twofactor.generate")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={reset}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : showDisable ? (
              <div className="space-y-2">
                <Label htmlFor="off-password">{t("twofactor.confirmPassword")}</Label>
                <Input
                  id="off-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Label htmlFor="off-code">{t("twofactor.currentOrRecovery")}</Label>
                <Input
                  id="off-code"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  autoComplete="one-time-code"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={onDisable}
                    disabled={disable.isPending || !password || !disableCode.trim()}
                  >
                    {disable.isPending ? t("common.working") : t("twofactor.turnOff")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={reset}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setShowRegenerate(true);
                  }}
                >
                  <RefreshCw /> {t("twofactor.newCodes")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    reset();
                    setShowDisable(true);
                  }}
                >
                  <ShieldOff /> {t("twofactor.turnOff")}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
