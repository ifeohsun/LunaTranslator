import { useMemo } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { createTranslator } from "@/lib/i18n";

export function useI18n() {
  const locale = useSettingsStore((state) => state.locale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  return { locale, t };
}
