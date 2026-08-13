import { useState } from "react";
import { useInstanceSettings, useUpdateInstanceSettings, useLogLevel, useSetLogLevel } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Button, HeaderBlock, Input, Panel, Screen, Toggle } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import { cn } from "@/lib/utils";

const LEVELS = ["trace", "debug", "info", "warn", "error"];

// ServerPage groups instance-wide administrative settings — the ones that are
// about the deployment rather than any one account.
export function ServerPage() {
  const t = useT();
  const { user } = useAuth();
  const { dateTime } = useDateFmt();
  const { data: settings } = useInstanceSettings();
  const updateSettings = useUpdateInstanceSettings();

  const { data: logState } = useLogLevel();
  const setLogLevel = useSetLogLevel();
  const [level, setLevel] = useState("debug");
  const [minutes, setMinutes] = useState(15);

  const overridden = Boolean(logState?.overrideUntil);

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("server.title")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
        />
      }
    >
      <div className="mt-4 flex flex-col gap-4">
        {/* Public enrollment: whether strangers can create their own accounts. */}
        <Panel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink dark:text-ink-dark">{t("admin.allowRegister")}</p>
              <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">{t("admin.allowRegisterHelp")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm">
              <Toggle
                id="allow-register"
                checked={settings?.allowRegister ?? false}
                disabled={!settings || updateSettings.isPending}
                onChange={(checked) => updateSettings.mutate({ allowRegister: checked })}
                label={t("admin.allowRegister")}
              />
              <label htmlFor="allow-register" className="cursor-pointer text-ink dark:text-ink-dark">
                {settings?.allowRegister ? t("common.on") : t("common.off")}
              </label>
            </div>
          </div>
        </Panel>

        {/* Runtime log level: raise it to troubleshoot, reverts automatically. */}
        <Panel title={t("server.logLevel")}>
          <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">{t("server.logLevelHelp")}</p>

          <p className="text-sm font-medium text-ink dark:text-ink-dark">
            {t("server.logLevelCurrent")} <span className="mono">{logState?.level ?? "—"}</span>
            {overridden && logState?.overrideUntil && (
              <span className="text-ink-4">
                {" "}
                — {t("server.logLevelUntil", { time: dateTime(logState.overrideUntil) })}
              </span>
            )}
            {!overridden && logState && (
              <span className="text-ink-4"> — {t("server.logLevelBaseline")}</span>
            )}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="log-level" className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">
                {t("server.logLevelSelect")}
              </label>
              <select
                id="log-level"
                className={cn(inputClass, "sm:w-40")}
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
              <label htmlFor="log-duration" className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">
                {t("server.logLevelDuration")}
              </label>
              <Input
                id="log-duration"
                type="number"
                min={1}
                max={1440}
                className={cn(inputClass, "sm:w-28")}
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
                variant="ghost"
                onClick={() =>
                  setLogLevel.mutate({ level: logState?.baseline ?? "info", durationMinutes: 0 })
                }
                disabled={setLogLevel.isPending}
              >
                {t("server.logLevelRevert")}
              </Button>
            )}
          </div>
        </Panel>
      </div>
    </Screen>
  );
}
