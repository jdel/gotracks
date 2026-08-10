import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

const TIMEZONES = (() => {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
})();

export function TimezonePicker({ value, onChange, ariaLabel }: { value: string; onChange: (zone: string) => void; ariaLabel: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const zones = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? TIMEZONES.filter((zone) => zone.toLowerCase().includes(query)) : TIMEZONES;
  }, [filter]);
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setFilter(""); }}>
    <PopoverAnchor asChild><Input value={value} readOnly onFocus={() => setOpen(true)} onClick={() => setOpen(true)} aria-label={ariaLabel} /></PopoverAnchor>
    <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-1">
      <Input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`${t("settings.tzFilter")}…`} aria-label={t("settings.tzFilter")} />
      <div className="mt-1 max-h-56 overflow-y-auto">
        {zones.map((zone) => <button key={zone} type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { onChange(zone); setOpen(false); setFilter(""); }}>{zone}</button>)}
        {zones.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("settings.tzNoMatch")}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
