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
import { TimezonePicker } from "@/components/TimezonePicker";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Panel, Toggle } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import { cn } from "@/lib/utils";
import { PasswordSection } from "@/components/PasswordSection";
import { PasskeySection } from "@/components/PasskeySection";
import { TwoFactorSection } from "@/components/TwoFactorSection";
import { SessionSection } from "@/components/SessionSection";
import { UsageBars } from "@/components/UsageBars";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Preference } from "@/lib/types";

const DATE_FORMATS = [
  { value: "2006-01-02", label: "2026-07-18" },
  { value: "02/01/2006", label: "18/07/2026" },
  { value: "01/02/2006", label: "07/18/2026" },
  { value: "02 Jan 2006", label: "18 Jul 2026" },
];

const fieldLabel = "text-[11px] font-bold text-ink-3 dark:text-ink-4-dark";

export function SettingsPage() {
  const t = useT();
  const { user } = useAuth();
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
    return <p className="p-6 text-sm font-medium text-ink-3">{t("actions.loading")}</p>;
  }

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("settings.title")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
          metrics={user?.email ? [{ label: user.email }] : []}
        />
      }
    >
      <div className="mt-4 flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-4 md:[align-content:start]">
        <Panel className="md:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-extrabold tracking-[-0.02em] text-ink dark:text-ink-dark">
              {t("settings.title")}
            </h2>
            {saved && (
              <span className="flex items-center gap-1 text-xs font-bold text-done-text dark:text-done-dark">
                <Check className="size-3" /> {t("settings.saved")}
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldLabel}>
              {t("settings.theme")}
              <select
                className={cn("mt-1", inputClass)}
                value={prefs.theme}
                onChange={(e) => set({ theme: e.target.value as Preference["theme"] })}
              >
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
              </select>
            </label>

            <label className={fieldLabel}>
              {t("settings.language")}
              <select
                className={cn("mt-1", inputClass)}
                value={prefs.locale}
                onChange={(e) => {
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

            <label className={fieldLabel}>
              {t("settings.timeZone")}
              <TimezonePicker value={prefs.timeZone} onChange={(zone) => set({ timeZone: zone })} ariaLabel={t("settings.timeZone")} />
            </label>

            <label className={fieldLabel}>
              {t("settings.dateFormat")}
              <select
                className={cn("mt-1", inputClass)}
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

            <label className={fieldLabel}>
              {t("settings.weekStart")}
              <select
                className={cn("mt-1", inputClass)}
                value={prefs.weekStart}
                onChange={(e) => set({ weekStart: Number(e.target.value) })}
              >
                <option value={0}>{t("weekday.long.0")}</option>
                <option value={1}>{t("weekday.long.1")}</option>
              </select>
            </label>

            <label className={fieldLabel}>
              {t("settings.reviewPeriod")}
              <Input
                type="number"
                min={1}
                className={cn("mt-1", inputClass)}
                value={prefs.reviewPeriod}
                onChange={(e) => set({ reviewPeriod: Math.max(1, Number(e.target.value)) })}
              />
            </label>

            {/* The help text sits outside the label: inside it, a screen
                reader would read the whole paragraph as the field's name. */}
            <div>
              <label className={fieldLabel}>
                {t("settings.showFromDays")}
                <Input
                  type="number"
                  min={0}
                  className={cn("mt-1", inputClass)}
                  value={prefs.showFromDays}
                  onChange={(e) => set({ showFromDays: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <p className="mt-1 text-xs font-medium text-ink-3 dark:text-ink-4-dark">
                {t("settings.showFromDaysHelp")}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line-3 pt-4 dark:border-line-dark">
            <div>
              <Label htmlFor="auto-delete-attachments" className="cursor-pointer text-sm font-medium text-ink dark:text-ink-dark">
                {t("settings.autoDeleteAttachments")}
              </Label>
              <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">
                {t("settings.autoDeleteAttachmentsHelp")}
              </p>
            </div>
            <Toggle
              id="auto-delete-attachments"
              checked={prefs.autoDeleteAttachments}
              disabled={update.isPending}
              onChange={(checked) => set({ autoDeleteAttachments: checked })}
              label={t("settings.autoDeleteAttachments")}
            />
          </div>
        </Panel>

        <Panel title={t("emailChange.settingsTitle")}>
          <form className="flex flex-col gap-4" onSubmit={(e) => void changeEmail(e)}>
            <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">{t("emailChange.settingsDescription")}</p>
            <label className={fieldLabel}>
              {t("emailChange.newEmail")}
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                className={cn("mt-1", inputClass)}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </label>
            {emailChangeSent && <p className="text-sm font-medium text-done-text dark:text-done-dark">{t("emailChange.sent")}</p>}
            {emailChangeError && <p className="text-sm font-medium text-danger">{emailChangeError}</p>}
            <Button type="submit" variant="outline" disabled={!newEmail || requestEmailChange.isPending}>
              {requestEmailChange.isPending ? t("common.working") : t("emailChange.send")}
            </Button>
          </form>
        </Panel>

        <PasswordSection />

        <PasskeySection />

        <TwoFactorSection />

        <SessionSection />

        <Panel title={t("usage.title")}>
          {usageLoading && <p className="text-sm font-medium text-ink-3">{t("common.loading")}</p>}
          {usageError && <p className="text-sm font-medium text-danger">{t("usage.loadError")}</p>}
          {usage && <UsageBars usage={usage} />}
        </Panel>

        <Panel title={t("settings.export")}>
          <Button variant="outline" size="sm" onClick={() => void downloadExport()}>
            <Download /> JSON
          </Button>
        </Panel>

        <Panel tone="danger" title={t("accountDeletion.dangerZone")}>
          <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">{t("accountDeletion.settingsDescription")}</p>
          {deletionSent && <p className="text-sm font-medium text-done-text dark:text-done-dark">{t("accountDeletion.emailSent")}</p>}
          {deletionError && <p className="text-sm font-medium text-danger">{deletionError}</p>}
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
        </Panel>
      </div>

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
    </Screen>
  );
}
