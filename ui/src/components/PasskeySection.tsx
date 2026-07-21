import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useDeletePasskey, usePasskeys, useServerConfig, type Passkey } from "@/hooks/useSettings";
import { enrolPasskey, isPasskeySupported } from "@/lib/passkeys";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

// PasskeySection lets a user enrol their own passkeys. Nothing is enabled for an
// account until it enrols one, so this is opt-in per user.
export function PasskeySection() {
  const t = useT();
  const fmt = useDateFmt();
  const { data: config } = useServerConfig();
  const enabled = config?.passkeys === true;
  const { data: passkeys, isLoading } = usePasskeys(enabled);
  const del = useDeletePasskey();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<Passkey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("passkey.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("passkey.notConfigured")}
            <code className="mx-1">TRACKS_RP_ID</code> {t("passkey.and")}
            <code className="mx-1">TRACKS_RP_ORIGIN</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function onEnrol() {
    setError("");
    setBusy(true);
    try {
      await enrolPasskey(name.trim() || t("passkey.defaultName"));
      setName("");
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (err) {
      // A user cancelling the browser prompt is not an error worth shouting about.
      const message = err instanceof Error ? err.message : t("passkey.errAdd");
      setError(/NotAllowed|abort/i.test(message) ? "" : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("passkey.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
{t("passkey.blurb")}
        </p>

        {!isPasskeySupported() && (
          <p className="text-sm text-destructive">{t("passkey.unsupported")}</p>
        )}

        <div className="flex gap-2">
          <Input
            placeholder={t("passkey.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button onClick={onEnrol} disabled={busy || !isPasskeySupported()}>
            <Plus /> {busy ? t("passkey.waiting") : t("common.add")}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

        <ul className="space-y-2">
          {passkeys?.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-md border p-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("passkey.added", { date: fmt.date(k.createdAt) })}
                  {k.lastUsedAt && ` · ${t("passkey.lastUsed", { date: fmt.date(k.lastUsedAt) })}`}
                </p>
              </div>
              <IconButton
                variant="ghost"
                label={t("passkey.removeLabel", { name: k.name })}
                onClick={() => setConfirming(k)}
              >
                <Trash2 className="size-4 text-destructive" />
              </IconButton>
            </li>
          ))}
        </ul>

        {passkeys?.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">{t("passkey.none")}</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("passkey.removeTitle")}
        description={
          <>
            <strong>{confirming?.name}</strong> {t("passkey.removeDescBody")}
          </>
        }
        confirmLabel={t("passkey.remove")}
        busy={del.isPending}
        onConfirm={() => {
          if (confirming) del.mutate(confirming.id);
          setConfirming(null);
        }}
      />
    </Card>
  );
}
