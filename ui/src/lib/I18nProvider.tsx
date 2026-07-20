import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePreferences } from "@/hooks/useSettings";
import { tokenStore } from "@/lib/api";
import {
  I18nContext,
  en,
  initialLocale,
  interpolate,
  isPluralOne,
  isSupported,
  locales,
  normaliseLocale,
  LOCALE_KEY,
  type I18nValue,
  type Key,
  type TFunc,
  type TnFunc,
} from "./i18n";

export function I18nProvider({ children }: { children: ReactNode }) {
  const { data: prefs } = usePreferences();
  const [local, setLocal] = useState(initialLocale);

  // The account's saved language wins once signed in, so signing in on a device
  // set to another language shows the account's own choice. Signed out there is
  // no account, so the device choice is authoritative — a stale preference left
  // in the query cache from an earlier session must not override the language
  // being picked on the registration form.
  const accountLocale = tokenStore.access ? prefs?.locale : undefined;
  const locale = normaliseLocale(accountLocale ?? local);

  const setLocale = useCallback((code: string) => {
    const next = normaliseLocale(code);
    localStorage.setItem(LOCALE_KEY, next);
    setLocal(next);
  }, []);

  // Mirror the account's language onto the device, so the next visit shows the
  // sign-in page in the right language before there is a session to read.
  useEffect(() => {
    if (prefs?.locale && isSupported(prefs.locale)) {
      localStorage.setItem(LOCALE_KEY, prefs.locale);
    }
  }, [prefs?.locale]);

  const value = useMemo<I18nValue>(() => {
    const lookup = (key: Key) => locales[locale]?.[key] ?? en[key];
    const t: TFunc = (key, params) => interpolate(lookup(key), params);
    const tn: TnFunc = (count, key, params) => {
      const form = isPluralOne(locale, count) ? "one" : "other";
      return t(`${key}.${form}` as Key, { count, ...params });
    };
    return { t, tn, locale, setLocale };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
