import { useState } from "react";
import { Download, Check } from "lucide-react";
import {
  downloadExport,
  usePreferences,
  useUpdatePreferences,
} from "@/hooks/useSettings";
import { availableLocales, useLocale, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimezonePicker } from "@/components/TimezonePicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordSection } from "@/components/PasswordSection";
import { PasskeySection } from "@/components/PasskeySection";
import { TwoFactorSection } from "@/components/TwoFactorSection";
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
  const update = useUpdatePreferences();
  const [saved, setSaved] = useState(false);

  function set(patch: Partial<Preference>) {
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      },
    });
  }

  if (isLoading || !prefs) {
    return <p className="text-sm text-muted-foreground">{t("actions.loading")}</p>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
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

      <PasswordSection />

      <PasskeySection />

      <TwoFactorSection />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.export")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void downloadExport()}>
            <Download /> JSON
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
