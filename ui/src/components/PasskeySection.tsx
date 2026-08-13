import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useDeletePasskey, usePasskeys, useServerConfig, type Passkey } from "@/hooks/useSettings";
import { enrolPasskey, isPasskeySupported } from "@/lib/passkeys";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/IconButton";
import { Button, Panel } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
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
      <Panel title={t("passkey.title")}>
        <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
          {t("passkey.notConfigured")}
          <code className="mono mx-1">TRACKS_RP_ID</code> {t("passkey.and")}
          <code className="mono mx-1">TRACKS_RP_ORIGIN</code>.
        </p>
      </Panel>
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
    <Panel title={t("passkey.title")}>
        <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">
          {t("passkey.blurb")}
        </p>

        {!isPasskeySupported() && (
          <p className="text-sm font-medium text-danger">{t("passkey.unsupported")}</p>
        )}

        <div className="flex gap-2">
          <input
            placeholder={t("passkey.namePlaceholder")}
            aria-label={t("passkey.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <Button onClick={onEnrol} disabled={busy || !isPasskeySupported()} className="flex-none">
            <Plus className="size-4" /> {busy ? t("passkey.waiting") : t("common.add")}
          </Button>
        </div>

        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        {isLoading && <p className="text-sm font-medium text-ink-3">{t("common.loading")}</p>}

        <ul className="flex flex-col gap-2">
          {passkeys?.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-control border border-line-3 p-2 dark:border-line-dark">
              <KeyRound className="size-4 shrink-0 text-ink-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink dark:text-ink-dark">{k.name}</p>
                <p className="text-xs font-medium text-ink-4">
                  {t("passkey.added", { date: fmt.date(k.createdAt) })}
                  {k.lastUsedAt && ` · ${t("passkey.lastUsed", { date: fmt.date(k.lastUsedAt) })}`}
                </p>
              </div>
              <IconButton
                label={t("passkey.removeLabel", { name: k.name })}
                onClick={() => setConfirming(k)}
              >
                <Trash2 className="size-4 text-danger" />
              </IconButton>
            </li>
          ))}
        </ul>

        {passkeys?.length === 0 && !isLoading && (
          <p className="text-sm font-medium text-ink-3">{t("passkey.none")}</p>
        )}
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
    </Panel>
  );
}
