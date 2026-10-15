import { create } from "zustand";
import type { ApiProvider } from "./translatorStore";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_LOCALE, detectLocale, type Locale } from "@/lib/i18n";

export const MIN_UI_SCALE = 0.7;
export const MAX_UI_SCALE = 1.7;
export const MIN_UI_OPACITY = 20;
export const MAX_UI_OPACITY = 100;
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2;
const DEFAULT_SELECTION_HOTKEY = "Ctrl+Alt+Y";
const LEGACY_SELECTION_HOTKEY = "Ctrl+Shift+Y";
const clampScale = (scale: number) =>
  Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, scale));
const clampOpacity = (opacity: number) => {
  const value = Number(opacity);
  return Number.isFinite(value)
    ? Math.round(Math.min(MAX_UI_OPACITY, Math.max(MIN_UI_OPACITY, value)))
    : MAX_UI_OPACITY;
};
const clampSpeechRate = (rate: number) => {
  const value = Number(rate);
  return Number.isFinite(value)
    ? Math.round(Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, value)) * 10) / 10
    : 1;
};

const STORE_DEFAULTS = {
  darkMode: true,
  autostart: false,
  startMinimized: false,
  apiKeys: {
    deepl: "",
    google: "",
    bing: "",
    lara: "",
    baidu: "",
    aliyun: "",
    custom: "",
  },
  activeApi: "google",
  openHotkey: "Ctrl+Shift+T",
  selectionHotkey: DEFAULT_SELECTION_HOTKEY,
  uiScale: 1,
  uiOpacity: 100,
  speechVoice: "",
  speechRate: 1,
  popupSourceLang: "auto",
  popupTargetLang: "auto",
  locale: DEFAULT_LOCALE,
};

interface SettingsState {
  darkMode: boolean;
  autostart: boolean;
  startMinimized: boolean;
  settingsOpen: boolean;
  apiKeys: Record<ApiProvider, string>;
  activeApi: ApiProvider;
  openHotkey: string;
  selectionHotkey: string;
  uiScale: number;
  uiOpacity: number;
  speechVoice: string;
  speechRate: number;
  locale: Locale;

  setDarkMode: (dark: boolean) => void;
  setAutostart: (auto: boolean) => void;
  setStartMinimized: (minimized: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setApiKey: (provider: ApiProvider, key: string) => void;
  setActiveApi: (api: ApiProvider) => void;
  setOpenHotkey: (accel: string) => void;
  setSelectionHotkey: (accel: string) => void;
  setUiScale: (scale: number) => void;
  setUiOpacity: (opacity: number) => void;
  setSpeechVoice: (voice: string) => void;
  setSpeechRate: (rate: number) => void;
  setLocale: (locale: Locale) => void;
  loadFromStore: () => Promise<void>;
  saveToStore: () => Promise<void>;
  clearStore: () => Promise<void>;
}


export const useSettingsStore = create<SettingsState>((set, get) => ({
  darkMode: true,
  autostart: false,
  startMinimized: false,
  settingsOpen: false,
  apiKeys: {
    deepl: "",
    google: "",
    bing: "",
    lara: "",
    baidu: "",
    aliyun: "",
    custom: "",
  },
  activeApi: "google",
  openHotkey: "Ctrl+Shift+T",
  selectionHotkey: DEFAULT_SELECTION_HOTKEY,
  uiScale: 1,
  uiOpacity: 100,
  speechVoice: "",
  speechRate: 1,
  locale: DEFAULT_LOCALE,

  setDarkMode: (dark: boolean) => {
    set({ darkMode: dark });
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", dark);
    }
  },

  setAutostart: (auto: boolean) => set({ autostart: auto }),
  setStartMinimized: (minimized: boolean) => set({ startMinimized: minimized }),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),

  setApiKey: (provider: ApiProvider, key: string) =>
    set((state) => ({
      apiKeys: { ...state.apiKeys, [provider]: key },
    })),

  setActiveApi: (api: ApiProvider) => set({ activeApi: api }),

  setOpenHotkey: (accel: string) => set({ openHotkey: accel }),
  setSelectionHotkey: (accel: string) => set({ selectionHotkey: accel }),
  setUiScale: (scale: number) =>
    set({ uiScale: Math.round(clampScale(scale) * 100) / 100 }),
  setUiOpacity: (opacity: number) => set({ uiOpacity: clampOpacity(opacity) }),
  setSpeechVoice: (voice: string) => set({ speechVoice: voice }),
  setSpeechRate: (rate: number) => set({ speechRate: clampSpeechRate(rate) }),
  setLocale: (locale: Locale) => {
    set({ locale });
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  },

  loadFromStore: async () => {
    try {
      const dataStr = await invoke<string>("load_settings");
      if (dataStr) {
        const parsed = JSON.parse(dataStr);
        const finalDarkMode = parsed.darkMode ?? true;
        const locale: Locale = parsed.locale === "zh-CN" || parsed.locale === "en"
          ? parsed.locale
          : detectLocale();
        const storedApiKeys =
          parsed.apiKeys && typeof parsed.apiKeys === "object"
            ? parsed.apiKeys
            : {};
        const hasRemovedTencent =
          Object.prototype.hasOwnProperty.call(storedApiKeys, "tencent") ||
          parsed.activeApi === "tencent";
        const { tencent: removedTencent, ...remainingApiKeys } = storedApiKeys;
        void removedTencent;
        set({
          darkMode: finalDarkMode,
          autostart: parsed.autostart ?? false,
          startMinimized: parsed.startMinimized ?? false,
          apiKeys: { ...STORE_DEFAULTS.apiKeys, ...remainingApiKeys },
          activeApi:
            parsed.activeApi === "tencent"
              ? STORE_DEFAULTS.activeApi
              : parsed.activeApi ?? STORE_DEFAULTS.activeApi,
          openHotkey: parsed.openHotkey ?? STORE_DEFAULTS.openHotkey,
          selectionHotkey:
            parsed.selectionHotkey === LEGACY_SELECTION_HOTKEY
              ? DEFAULT_SELECTION_HOTKEY
              : parsed.selectionHotkey ?? STORE_DEFAULTS.selectionHotkey,
          uiScale: clampScale(parsed.uiScale ?? STORE_DEFAULTS.uiScale),
          uiOpacity: clampOpacity(parsed.uiOpacity ?? STORE_DEFAULTS.uiOpacity),
          speechVoice:
            typeof parsed.speechVoice === "string"
              ? parsed.speechVoice
              : STORE_DEFAULTS.speechVoice,
          speechRate: clampSpeechRate(parsed.speechRate ?? STORE_DEFAULTS.speechRate),
          locale,
        });
        document.documentElement.lang = locale;
        if (finalDarkMode) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        if (hasRemovedTencent) {
          await get().saveToStore();
        }
      } else {
        
        const locale = detectLocale();
        set({ darkMode: true, locale });
        document.documentElement.classList.add("dark");
        document.documentElement.lang = locale;
      }
    } catch (e) {
      console.log("Running outside Tauri, using defaults", e);
      const locale = detectLocale();
      set({ darkMode: true, locale });
      document.documentElement.classList.add("dark");
      document.documentElement.lang = locale;
    }
  },

  saveToStore: async () => {
    try {
      const state = get();
      const payload = JSON.stringify({
        darkMode: state.darkMode,
        autostart: state.autostart,
        startMinimized: state.startMinimized,
        apiKeys: state.apiKeys,
        activeApi: state.activeApi,
        openHotkey: state.openHotkey,
        selectionHotkey: state.selectionHotkey,
        uiScale: state.uiScale,
        uiOpacity: state.uiOpacity,
        speechVoice: state.speechVoice,
        speechRate: state.speechRate,
        locale: state.locale,
      });
      await invoke("save_settings", { payload });
    } catch (e) {
      console.log("Failed to save native store:", e);
    }
  },

  clearStore: async () => {
    try {
      await invoke("save_settings", { payload: "{}" });
    } catch (e) {
      console.log("Failed to clear native store:", e);
    }
  },
}));
