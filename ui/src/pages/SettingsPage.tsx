import { useState, type FormEvent } from "react";
import { Download, Check, Trash2 } from "lucide-react";
import {
  downloadExport,
  useMyUsage,
  usePreferences,
  useRequestAccountDeletion,
  useRequestEmailChange,
  useUpdatePreferences,
} from "@/hooks/useSettings";
import { apiMessage } from "@/lib/api";
import { availableLocales, useLocale, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimezonePicker } from "@/components/TimezonePicker";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordSection } from "@/components/PasswordSection";
import { PasskeySection } from "@/components/PasskeySection";
import { TwoFactorSection } from "@/components/TwoFactorSection";
import { UsageBars } from "@/components/UsageBars";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Preference } from "@/lib/types";

const DATE_FORMATS = [
  { value: "2006-01-02", label: "2026-07-18" },
  { value: "02/01/2006", label: "18/07/2026" },
  { value: "01/02/2006", label: "07/18/2026" },
  { value: "02 Jan 2006", label: "18 Jul 2026" },
];

export function SettingsPage() {
  const t = useT();
  const { setLocale } = useLocale();
  const { data: prefs, isLoading } = usePreferences();
  const { data: usage, isLoading: usageLoading, error: usageError } = useMyUsage();
  const update = useUpdatePreferences();
  const requestDeletion = useRequestAccountDeletion();
  const requestEmailChange = useRequestEmailChange();
  const [saved, setSaved] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionSent, setDeletionSent] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailChangeSent, setEmailChangeSent] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState("");

  function set(patch: Partial<Preference>) {
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      },
    });
  }

  async function requestAccountDeletion() {
    setDeletionError("");
    try {
      await requestDeletion.mutateAsync();
      setDeletionOpen(false);
      setDeletionSent(true);
    } catch (err) {
      setDeletionError(apiMessage(err, t("accountDeletion.requestError")));
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailChangeError("");
    setEmailChangeSent(false);
    try {
      await requestEmailChange.mutateAsync({ newEmail });
      setEmailChangeSent(true);
      setNewEmail("");
    } catch (err) {
      setEmailChangeError(apiMessage(err, t("emailChange.requestError")));
    }
  }

  if (isLoading || !prefs) {
    return <p className="text-sm text-muted-foreground">{t("actions.loading")}</p>;
  }

  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("settings.title")}</CardTitle>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <Check className="size-3" /> {t("settings.saved")}
            </span>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            {t("settings.theme")}
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={prefs.theme}
              onChange={(e) => set({ theme: e.target.value as Preference["theme"] })}
            >
              <option value="system">{t("settings.themeSystem")}</option>
              <option value="light">{t("settings.themeLight")}</option>
              <option value="dark">{t("settings.themeDark")}</option>
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            {t("settings.language")}
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={prefs.locale}
              onChange={(e) => {
                // Saved on the account and remembered on this device, so the
                // next sign-in page renders in the same language.
                set({ locale: e.target.value });
                setLocale(e.target.value);
              }}
            >
              {availableLocales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            {t("settings.timeZone")}
            <TimezonePicker value={prefs.timeZone} onChange={(zone) => set({ timeZone: zone })} ariaLabel={t("settings.timeZone")} />
          </label>

          <label className="text-xs text-muted-foreground">
            {t("settings.dateFormat")}
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={prefs.dateFormat}
              onChange={(e) => set({ dateFormat: e.target.value })}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            {t("settings.weekStart")}
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={prefs.weekStart}
              onChange={(e) => set({ weekStart: Number(e.target.value) })}
            >
              <option value={0}>{t("weekday.long.0")}</option>
              <option value={1}>{t("weekday.long.1")}</option>
            </select>
          </label>

          <label className="text-xs text-muted-foreground">
            {t("settings.reviewPeriod")}
            <Input
              type="number"
              min={1}
              className="mt-1"
              value={prefs.reviewPeriod}
              onChange={(e) => set({ reviewPeriod: Math.max(1, Number(e.target.value)) })}
            />
          </label>
        </CardContent>
        <CardContent className="flex items-center justify-between gap-4 border-t pt-4">
          <div>
            <Label htmlFor="auto-delete-attachments" className="cursor-pointer text-sm font-normal">
              {t("settings.autoDeleteAttachments")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.autoDeleteAttachmentsHelp")}
            </p>
          </div>
          <Switch
            id="auto-delete-attachments"
            checked={prefs.autoDeleteAttachments ?? false}
            disabled={update.isPending}
            onCheckedChange={(checked) => set({ autoDeleteAttachments: checked })}
            aria-label={t("settings.autoDeleteAttachments")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("emailChange.settingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void changeEmail(e)}>
            <p className="text-sm text-muted-foreground">{t("emailChange.settingsDescription")}</p>
            <div className="space-y-2">
              <Label htmlFor="new-email">{t("emailChange.newEmail")}</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            {emailChangeSent && <p className="text-sm text-emerald-600">{t("emailChange.sent")}</p>}
            {emailChangeError && <p className="text-sm text-destructive">{emailChangeError}</p>}
            <Button type="submit" variant="outline" disabled={!newEmail || requestEmailChange.isPending}>
              {requestEmailChange.isPending ? t("common.working") : t("emailChange.send")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PasswordSection />

      <PasskeySection />

      <TwoFactorSection />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("usage.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {usageLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {usageError && <p className="text-sm text-destructive">{t("usage.loadError")}</p>}
          {usage && <UsageBars usage={usage} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.export")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => void downloadExport()}>
            <Download /> JSON
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/60">
        <CardHeader>
          <CardTitle className="text-base text-destructive">{t("accountDeletion.settingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("accountDeletion.settingsDescription")}</p>
          {deletionSent && <p className="text-sm text-emerald-600">{t("accountDeletion.emailSent")}</p>}
          {deletionError && <p className="text-sm text-destructive">{deletionError}</p>}
          <Button
            variant="destructive"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => {
              setDeletionError("");
              setDeletionOpen(true);
            }}
          >
            <Trash2 /> {t("accountDeletion.settingsButton")}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deletionOpen}
        onOpenChange={setDeletionOpen}
        title={t("accountDeletion.requestTitle")}
        description={
          <span>
            <span className="block">{t("accountDeletion.warning")}</span>
            <span className="mt-2 block">{t("accountDeletion.exportBeforeDeleting")}</span>
          </span>
        }
        confirmLabel={t("accountDeletion.requestButton")}
        busy={requestDeletion.isPending}
        onConfirm={() => void requestAccountDeletion()}
      />

    </PageContainer>
  );
}
