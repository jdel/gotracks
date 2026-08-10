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
import { Button, Field, Panel } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import type { TwoFactorEnrolment } from "@/lib/types";
import { useT, useTn } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

// TwoFactorSection lets a user turn on an authenticator app for their own
// account. Opt-in per user: nothing changes for anyone who ignores it.
export function TwoFactorSection() {
  const t = useT();
  const fmt = useDateFmt();
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
      <Panel title={t("twofactor.saveTitle")}>
          <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("twofactor.saveIntro")}</p>
          <ul className="mono grid grid-cols-2 gap-2 rounded-control border border-line-3 p-3 text-sm text-ink dark:border-line-dark dark:text-ink-dark">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={copyCodes}>
              <Copy className="size-4" /> {t("twofactor.copy")}
            </Button>
            <Button type="button" variant="ghost" onClick={downloadCodes}>
              <Download className="size-4" /> {t("twofactor.download")}
            </Button>
          </div>
          <Button type="button" className="w-full" onClick={() => setRecoveryCodes(null)}>
            {t("twofactor.saved")}
          </Button>
      </Panel>
    );
  }

  return (
    <Panel title={t("twofactor.title")}>
        {isLoading && <p className="text-sm font-medium text-ink-3">{t("common.loading")}</p>}

        {!isLoading && !status?.enabled && !enrolment && (
          <>
            <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("twofactor.intro")}</p>
            <Button type="button" onClick={onBegin} disabled={begin.isPending}>
              <ShieldCheck className="size-4" /> {begin.isPending ? t("twofactor.preparing") : t("twofactor.setup")}
            </Button>
          </>
        )}

        {enrolment && (
          <div className="space-y-4">
<p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("twofactor.scan")}</p>
            <img src={enrolment.qr} alt={t("twofactor.qrAlt")} className="rounded-control border border-line-2 dark:border-line-2-dark" />
            <p className="text-xs font-medium text-ink-4">
              {t("twofactor.cantScan")}{" "}
              <code className="break-all font-mono">{enrolment.secret}</code>
            </p>
            <Field label={t("twofactor.codeFromApp")}>
              <input
                id="totp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className={inputClass}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="button" onClick={onFinish} disabled={finish.isPending || !code.trim()}>
                {finish.isPending ? t("twofactor.verifying") : t("twofactor.turnOn")}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {!isLoading && status?.enabled && !enrolment && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
              {t("twofactor.onSince", { date: status.enabledAt ? fmt.date(status.enabledAt) : "—" })}{" "}
              {tn(status.recoveryCodesRemaining, "twofactor.codesLeft")}
            </p>

            {showRegenerate ? (
              <div className="space-y-2">
                <Field label={t("twofactor.confirmPassword")}>
                  <input
                    id="regen-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </Field>
<p className="text-xs font-medium text-ink-4">{t("twofactor.replaceWarn")}</p>
                <div className="flex gap-2">
                  <Button type="button" onClick={onRegenerate} disabled={regenerate.isPending}>
                    {regenerate.isPending ? t("common.working") : t("twofactor.generate")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : showDisable ? (
              <div className="space-y-2">
                <Field label={t("twofactor.confirmPassword")}>
                  <input
                    id="off-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label={t("twofactor.currentOrRecovery")}>
                  <input
                    id="off-code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    autoComplete="one-time-code"
                    className={inputClass}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={onDisable}
                    disabled={disable.isPending || !password || !disableCode.trim()}
                  >
                    {disable.isPending ? t("common.working") : t("twofactor.turnOff")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    reset();
                    setShowRegenerate(true);
                  }}
                >
                  <RefreshCw className="size-4" /> {t("twofactor.newCodes")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    reset();
                    setShowDisable(true);
                  }}
                >
                  <ShieldOff className="size-4" /> {t("twofactor.turnOff")}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm font-medium text-danger">{error}</p>}
    </Panel>
  );
}
