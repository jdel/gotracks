import { useState } from "react";
import { Monitor, Trash2 } from "lucide-react";
import { useSessions, useRevokeSession, useRevokeOtherSessions } from "@/hooks/useSessions";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sessions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("sessions.subtitle")}</p>

        <ul className="space-y-2">
          {(sessions ?? []).map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0 space-y-0.5 text-sm">
                <div className="flex items-center gap-2">
                  <Monitor className="size-4 shrink-0 text-muted-foreground" />
                  <span className="break-all">{s.userAgent || t("sessions.unknownDevice")}</span>
                  {s.current && (
                    <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium">
                      {t("sessions.current")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.ip || t("sessions.unknownAddress")} · {t("sessions.lastUsed")} {dateTime(s.lastUsed)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("sessions.signedIn")} {dateTime(s.startedAt)}
                </p>
              </div>
              {!s.current && (
                <IconButton
                  variant="ghost"
                  label={t("sessions.revoke")}
                  onClick={() => end(s.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 />
                </IconButton>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {others > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingOthers(true)}
            disabled={revokeOthers.isPending}
          >
            {t("sessions.signOutOthers")}
          </Button>
        )}
      </CardContent>

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
    </Card>
  );
}
