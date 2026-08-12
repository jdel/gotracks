import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { FilterPicker } from "@/components/FilterPicker";

const TIMEZONES = (() => {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
})();

/** The account's time zone, out of several hundred — the filter is the point. */
export function TimezonePicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (zone: string) => void;
  ariaLabel: string;
}) {
  const t = useT();
  const options = useMemo(() => TIMEZONES.map((zone) => ({ value: zone, label: zone })), []);
  return (
    <FilterPicker
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      filterLabel={t("settings.tzFilter")}
      noMatchLabel={t("settings.tzNoMatch")}
    />
  );
}
