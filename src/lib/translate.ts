import type { ApiProvider } from "@/store/translatorStore";
import { AUTO_TARGET_LANGUAGE } from "@/store/translatorStore";
import type { Locale } from "@/lib/i18n";
import { Credentials, Translator } from "@translated/lara";

export interface TranslationResult {
  translatedText: string;
  detectedLanguage: string | null;
  alternatives: string[];
}

export async function translateText(
  text: string,
  from: string,
  to: string,
  api: ApiProvider,
  apiKey: string,
  useFreeApi: boolean = false
): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translatedText: "", detectedLanguage: null, alternatives: [] };
  }

  const isFree = (api === "google" && !apiKey.trim()) || useFreeApi;

  if (!apiKey && !isFree) {
    throw new Error(`No API key set for ${api}. Please add one in Settings.`);
  }

  if (api === "lara" && !useFreeApi) {
    const parts = apiKey.split(/[:,]/);
    if (parts.length < 2) {
      throw new Error(
        "Lara Translate requires both an AccessKeyID and an AccessKeySecret, separated by a comma (e.g., ID,Secret)"
      );
    }
    const [id, secret] = parts;
    const credentials = new Credentials(id.trim(), secret.trim());
    const lara = new Translator(credentials);

    try {
      const resp = await lara.translate(text, from === "auto" ? detectLanguageSimple(text) : from, to);
      const res = resp as unknown as Record<string, unknown>;
      
      let translatedText = text;
      if (typeof res.translation === "string") {
        translatedText = res.translation;
      } else if (res.data && typeof (res.data as Record<string, unknown>).translation === "string") {
        translatedText = (res.data as Record<string, unknown>).translation as string;
      }

      let detectedLanguage = null;
      if (typeof res.detected_language === "string") {
        detectedLanguage = res.detected_language;
      } else if (res.data && typeof (res.data as Record<string, unknown>).detected_language === "string") {
        detectedLanguage = (res.data as Record<string, unknown>).detected_language as string;
      }

      return {
        translatedText,
        detectedLanguage,
        alternatives: [],
      };
    } catch (e: unknown) {
      throw new Error((e as Error)?.message || "Lara Translation failed");
    }
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{
      translated_text: string;
      detected_language: string | null;
      alternatives: string[];
    }>("translate_text", {
      request: { text, from, to, api, api_key: apiKey, use_free_api: useFreeApi },
    });

    return {
      translatedText: result.translated_text,
      detectedLanguage: result.detected_language,
      alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
    };
  } catch (e) {
    throw new Error(
      typeof e === "string" ? e : (e as Error)?.message || "Translation failed"
    );
  }
}

export async function validateApiKey(
  api: ApiProvider,
  apiKey: string
): Promise<boolean> {
  if (api === "google" || api === "bing") {
    return apiKey.trim().length > 0;
  }

  if (api === "lara") {
    const parts = apiKey.split(/[:,]/);
    if (parts.length < 2) return false;
    const [id, secret] = parts;
    if (id.trim().length < 5 || secret.trim().length < 5) return false;
    return true;
  }
  
  if (api === "custom") {
    try {
      new URL(apiKey);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("validate_api_key", {
      api,
      apiKey,
    });
  } catch {
    return false;
  }
}

export function detectLanguageSimple(text: string): string {
  const cyrillicRegex = /[\u0400-\u04FF]/;
  const japaneseRegex = /[\u3040-\u30FF\u31F0-\u31FF]/;
  const cjkRegex = /[\u4E00-\u9FFF]/;
  const arabicRegex = /[\u0600-\u06FF]/;
  const koreanRegex = /[\uAC00-\uD7AF]/;
  const thaiRegex = /[\u0E00-\u0E7F]/;
  const devanagariRegex = /[\u0900-\u097F]/;

  if (cyrillicRegex.test(text)) return "ru";
  if (koreanRegex.test(text)) return "ko";
  if (japaneseRegex.test(text)) return "ja";
  if (cjkRegex.test(text)) return "zh";
  if (arabicRegex.test(text)) return "ar";
  if (thaiRegex.test(text)) return "th";
  if (devanagariRegex.test(text)) return "hi";
  return "en";
}

export function resolveTargetLanguage(
  text: string,
  targetLang: string,
  locale: Locale,
  sourceLang = "auto"
): string {
  if (targetLang !== AUTO_TARGET_LANGUAGE) return targetLang;

  const uiLanguage = locale === "zh-CN" ? "zh" : "en";
  const detectedLanguage = sourceLang === "auto"
    ? detectLanguageSimple(text)
    : sourceLang === "zh-CN"
      ? "zh"
      : sourceLang;

  return detectedLanguage === uiLanguage
    ? uiLanguage === "zh" ? "en" : "zh"
    : uiLanguage;
}

