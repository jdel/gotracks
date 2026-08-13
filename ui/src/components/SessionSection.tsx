import { useState } from "react";
import { Monitor, Trash2 } from "lucide-react";
import { useSessions, useRevokeSession, useRevokeOtherSessions } from "@/hooks/useSessions";
import { IconButton } from "@/components/IconButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, Panel, Chip } from "@/components/primitives";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

/**
 * Lets a user see and end their own sign-ins.
 *
 * One row per session — the chain of refresh tokens a sign-in rotates through
 * reads as a single device — with the current one marked and not revocable from
 * here (signing out of the session you are using is what the sign-out button is
 * for). Everything else can be ended individually or all at once.
 */
export function SessionSection() {
  const t = useT();
  const { dateTime } = useDateFmt();
  const { data: sessions } = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [confirmingOthers, setConfirmingOthers] = useState(false);
  const [error, setError] = useState("");

  const others = (sessions ?? []).filter((s) => !s.current).length;

  async function end(id: string) {
    setError("");
    try {
      await revoke.mutateAsync(id);
    } catch (err) {
      setError(apiMessage(err, t("sessions.revokeFailed")));
    }
  }

  return (
    <Panel title={t("sessions.title")}>
        <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("sessions.subtitle")}</p>

        <ul className="flex flex-col gap-2">
          {(sessions ?? []).map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 rounded-control border border-line-3 p-3 dark:border-line-dark">
              <div className="min-w-0 space-y-0.5 text-sm">
                <div className="flex items-center gap-2">
                  <Monitor className="size-4 shrink-0 text-ink-4" />
                  <span className="line-clamp-2 font-medium text-ink dark:text-ink-dark">{s.userAgent || t("sessions.unknownDevice")}</span>
                  {s.current && (
                    <span className="shrink-0">
                      <Chip tone="done">{t("sessions.current")}</Chip>
                    </span>
                  )}
                </div>
                <p className="mono text-[10px] text-ink-4">
                  {s.ip || t("sessions.unknownAddress")} · {t("sessions.lastUsed")} {dateTime(s.lastUsed)}
                </p>
                <p className="mono text-[10px] text-ink-4">
                  {t("sessions.signedIn")} {dateTime(s.startedAt)}
                </p>
              </div>
              {!s.current && (
                <IconButton
                  label={t("sessions.revoke")}
                  onClick={() => end(s.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 className="text-danger" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm font-medium text-danger">{error}</p>}

        {others > 0 && (
          <Button
            variant="ghost"
            className="w-fit"
            onClick={() => setConfirmingOthers(true)}
            disabled={revokeOthers.isPending}
          >
            {t("sessions.signOutOthers")}
          </Button>
        )}

      <ConfirmDialog
        open={confirmingOthers}
        onOpenChange={(open) => !open && setConfirmingOthers(false)}
        title={t("sessions.signOutOthers")}
        description={<>{t("sessions.signOutOthersDesc", { count: String(others) })}</>}
        confirmLabel={t("sessions.signOutOthers")}
        busy={revokeOthers.isPending}
        onConfirm={async () => {
          setConfirmingOthers(false);
          setError("");
          try {
            await revokeOthers.mutateAsync();
          } catch (err) {
            setError(apiMessage(err, t("sessions.revokeFailed")));
          }
        }}
      />
    </Panel>
  );
}
