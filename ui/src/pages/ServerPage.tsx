import { useState } from "react";
import { useInstanceSettings, useUpdateInstanceSettings, useLogLevel, useSetLogLevel } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const LEVELS = ["trace", "debug", "info", "warn", "error"];

// ServerPage groups instance-wide administrative settings — the ones that are
// about the deployment rather than any one account.
export function ServerPage() {
  const t = useT();
  const { dateTime } = useDateFmt();
  const { data: settings } = useInstanceSettings();
  const updateSettings = useUpdateInstanceSettings();

  const { data: logState } = useLogLevel();
  const setLogLevel = useSetLogLevel();
  const [level, setLevel] = useState("debug");
  const [minutes, setMinutes] = useState(15);

  const overridden = Boolean(logState?.overrideUntil);

  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("server.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("server.subtitle")}</p>
      </div>

      {/* Public enrollment: whether strangers can create their own accounts. */}
      <Card className="flex items-start justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium">{t("admin.allowRegister")}</p>
          <p className="text-xs text-muted-foreground">{t("admin.allowRegisterHelp")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            id="allow-register"
            checked={settings?.allowRegister ?? false}
            disabled={!settings || updateSettings.isPending}
            onCheckedChange={(checked) => updateSettings.mutate({ allowRegister: checked })}
            aria-label={t("admin.allowRegister")}
          />
          <Label htmlFor="allow-register" className="cursor-pointer">
            {settings?.allowRegister ? t("common.on") : t("common.off")}
          </Label>
        </div>
      </Card>

      {/* Runtime log level: raise it to troubleshoot, reverts automatically. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("server.logLevel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("server.logLevelHelp")}</p>

          <p className="text-sm">
            {t("server.logLevelCurrent")}{" "}
            <span className="font-mono font-medium">{logState?.level ?? "—"}</span>
            {overridden && logState?.overrideUntil && (
              <span className="text-muted-foreground">
                {" "}
                — {t("server.logLevelUntil", { time: dateTime(logState.overrideUntil) })}
              </span>
            )}
            {!overridden && logState && (
              <span className="text-muted-foreground"> — {t("server.logLevelBaseline")}</span>
            )}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="log-level">{t("server.logLevelSelect")}</Label>
              <select
                id="log-level"
                className="block h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="log-duration">{t("server.logLevelDuration")}</Label>
              <Input
                id="log-duration"
                type="number"
                min={1}
                max={1440}
                className="w-28"
                value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <Button
              onClick={() => setLogLevel.mutate({ level, durationMinutes: minutes })}
              disabled={setLogLevel.isPending}
            >
              {t("server.logLevelApply")}
            </Button>
            {overridden && (
              <Button
                variant="outline"
                onClick={() =>
                  setLogLevel.mutate({ level: logState?.baseline ?? "info", durationMinutes: 0 })
                }
                disabled={setLogLevel.isPending}
              >
                {t("server.logLevelRevert")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
