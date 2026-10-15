"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MAX_UI_OPACITY,
  MIN_UI_OPACITY,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  useSettingsStore,
} from "@/store/settingsStore";
import { useTranslatorStore, API_PROVIDERS } from "@/store/translatorStore";
import type { ApiProvider } from "@/store/translatorStore";
import { validateApiKey } from "@/lib/translate";
import { loadCache } from "@/lib/settingsCache";
import { APP_VERSION } from "@/lib/version";
import { useI18n } from "@/lib/useI18n";
import { listSpeechVoices, type SpeechVoice } from "@/lib/speech";
import type { Locale } from "@/lib/i18n";
import ChangelogModal from "@/components/ChangelogModal";
import LanguageSelector from "@/components/LanguageSelector";
import {
  X,
  Moon,
  Sun,
  Key,
  Keyboard,
  Copy,
  Monitor,
  FileText,
  Trash2,
  Check,
  Loader2,
  Eye,
  EyeOff,
  ZoomIn,
  Minus,
  Plus,
  Minimize2,
  ExternalLink,
  ChevronDown,
  Volume2,
  Gauge,
} from "lucide-react";

const PROVIDER_DOCS: Partial<Record<ApiProvider, string>> = {
  deepl: "https://developers.deepl.com/docs/getting-started/auth",
  google: "https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate",
  bing: "https://learn.microsoft.com/en-us/rest/api/translator/translator/translate?view=rest-translator-v3.0",
  lara: "https://developers.laratranslate.com/docs/getting-started",
  baidu: "https://fanyi-api.baidu.com/doc/11",
  aliyun: "https://help.aliyun.com/zh/machine-translation/developer-reference/api-reference-machine-translation-universal-version-call-guide",
};

function openExternalLink(url: string) {
  void import("@tauri-apps/plugin-shell")
    .then(({ open }) => open(url))
    .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

export default function SettingsPanel() {
  const {
    settingsOpen,
    setSettingsOpen,
    darkMode,
    setDarkMode,
    autostart,
    setAutostart,
    startMinimized,
    setStartMinimized,
    apiKeys,
    setApiKey,
    activeApi,
    setActiveApi,
    openHotkey,
    setOpenHotkey,
    selectionHotkey,
    setSelectionHotkey,
    uiScale,
    setUiScale,
    uiOpacity,
    setUiOpacity,
    speechVoice,
    setSpeechVoice,
    speechRate,
    setSpeechRate,
    locale,
    setLocale,
    saveToStore,
    clearStore,
  } = useSettingsStore();

  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [recordingSelectionHotkey, setRecordingSelectionHotkey] = useState(false);

  const { setActiveApi: setTranslatorApi } = useTranslatorStore();
  const { t } = useI18n();

  const [editingKeys, setEditingKeys] = useState<
    Record<ApiProvider, string>
  >({
    deepl: "",
    google: "",
    bing: "",
    lara: "",
    baidu: "",
    aliyun: "",
    custom: "",
  });

  const [validating, setValidating] = useState<ApiProvider | null>(null);
  const [validationResult, setValidationResult] = useState<
    Record<string, boolean | null>
  >({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [autostartFailed, setAutostartFailed] = useState(false);
  const [speechVoices, setSpeechVoices] = useState<SpeechVoice[]>([]);

  useEffect(() => {
    setEditingKeys({ ...apiKeys });
  }, [apiKeys, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    setAutostartFailed(false);

    (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        const enabled = await isEnabled();
        if (enabled !== autostart) {
          setAutostart(enabled);
          await saveToStore();
        }
      } catch (e) {
        console.log("Autostart not available:", e);
      }
    })();
  }, [settingsOpen, autostart, setAutostart, saveToStore]);

  useEffect(() => {
    if (!settingsOpen) return;

    let cancelled = false;
    void listSpeechVoices()
      .then((voices) => {
        if (!cancelled) setSpeechVoices(voices);
      })
      .catch(() => {
        if (!cancelled) setSpeechVoices([]);
      });

    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const handleSaveKey = useCallback(
    async (provider: ApiProvider) => {
      const key = editingKeys[provider];
      if (!key.trim()) return;

      setValidating(provider);
      setValidationResult((prev) => ({ ...prev, [provider]: null }));

      const isValid = await validateApiKey(provider, key);

      setValidationResult((prev) => ({ ...prev, [provider]: isValid }));
      setValidating(null);

      if (isValid) {
        setApiKey(provider, key);
        await saveToStore();
        setTimeout(
          () =>
            setValidationResult((prev) => ({ ...prev, [provider]: null })),
          3000
        );
      }
    },
    [editingKeys, setApiKey, saveToStore]
  );

  const handleSetActive = useCallback(
    async (api: ApiProvider) => {
      setActiveApi(api);
      setTranslatorApi(api);
      await saveToStore();
    },
    [setActiveApi, setTranslatorApi, saveToStore]
  );

  const handleDarkModeToggle = useCallback(async () => {
    setDarkMode(!darkMode);
    await saveToStore();
  }, [darkMode, setDarkMode, saveToStore]);

  const handleAutostartToggle = useCallback(async () => {
    const newValue = !autostart;
    setAutostartFailed(false);

    try {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      if (newValue) {
        await enable();
      } else {
        await disable();
      }
    } catch (e) {
      console.log("Autostart not available:", e);
      setAutostartFailed(true);
      return;
    }

    setAutostart(newValue);
    await saveToStore();
  }, [autostart, setAutostart, saveToStore]);

  const handleStartMinimizedToggle = useCallback(async () => {
    setStartMinimized(!startMinimized);
    await saveToStore();
  }, [startMinimized, setStartMinimized, saveToStore]);

  const handleScale = useCallback(
    async (scale: number) => {
      setUiScale(scale);
      await saveToStore();
    },
    [setUiScale, saveToStore]
  );

  const handleOpacity = useCallback(
    async (opacity: number) => {
      setUiOpacity(opacity);
      await saveToStore();
    },
    [setUiOpacity, saveToStore]
  );

  const handleSpeechVoice = useCallback(
    async (voice: string) => {
      setSpeechVoice(voice);
      await saveToStore();
    },
    [setSpeechVoice, saveToStore]
  );

  const handleSpeechRate = useCallback(
    async (rate: number) => {
      setSpeechRate(rate);
      await saveToStore();
    },
    [setSpeechRate, saveToStore]
  );

  const handleLocaleChange = useCallback(
    async (nextLocale: Locale) => {
      setLocale(nextLocale);
      await saveToStore();
    },
    [setLocale, saveToStore]
  );

  const applyOpenHotkey = useCallback(
    async (accel: string) => {
      setOpenHotkey(accel);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_open_hotkey", { accelerator: accel });
      } catch (e) {
        console.log("Failed to set open hotkey:", e);
      }
      await saveToStore();
    },
    [setOpenHotkey, saveToStore]
  );

  const handleHotkeyKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!recordingHotkey) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingHotkey(false);
        return;
      }

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Super");

      let key: string | null = null;
      if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
      else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;

      if (!key || mods.length === 0) return;

      setRecordingHotkey(false);
      applyOpenHotkey([...mods, key].join("+"));
    },
    [recordingHotkey, applyOpenHotkey]
  );

  const applySelectionHotkey = useCallback(
    async (accel: string) => {
      setSelectionHotkey(accel);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_selection_hotkey", { accelerator: accel });
      } catch (e) {
        console.log("Failed to set selection hotkey:", e);
      }
      await saveToStore();
    },
    [setSelectionHotkey, saveToStore]
  );

  const handleSelectionHotkeyKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!recordingSelectionHotkey) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingSelectionHotkey(false);
        return;
      }

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Super");

      let key: string | null = null;
      if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
      else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;

      if (!key || mods.length === 0) return;

      setRecordingSelectionHotkey(false);
      applySelectionHotkey([...mods, key].join("+"));
    },
    [recordingSelectionHotkey, applySelectionHotkey]
  );

  const handleClearData = useCallback(async () => {
    try {
      const store = await loadCache();
      await store.clear();
      await store.save();
      await clearStore();
      window.location.reload();
    } catch {
      console.log("Store not available");
    }
  }, [clearStore]);

  return (
    <>
      <div
        className={`absolute inset-0 z-40 transition-opacity duration-300 bg-black/50 ${settingsOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setSettingsOpen(false)}
      />

      <div
        className={`absolute right-0 top-0 bottom-0 w-100 max-w-[90vw] z-50 overflow-y-auto transition-transform duration-500 ease-[cubic-bezier(0.2,0,0,1)] bg-surface-low rounded-l-(--md-shape-sm) ${settingsOpen ? "translate-x-0 shadow-2xl" : "translate-x-full"}`}
      >
        <div
          className="sticky top-0 z-10 px-6 py-5 flex items-center justify-between bg-surface-low border-b border-(--md-outline-variant)"
        >
          <h2
            className="text-xl font-normal text-foreground tracking-tight"
          >
            {t("settings.title")}
          </h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="md-icon-btn"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-8">
          <section>
            <h3
              className="text-sm font-medium mb-4 text-primary tracking-wide"
            >
              {t("settings.translationApi")}
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-secondary">
              {t("settings.apiHint")}
            </p>

            <div className="flex flex-col gap-2">
              {API_PROVIDERS.map((provider) => {
                const isActive = activeApi === provider.id;
                const hasKey = !!apiKeys[provider.id];
                const isFreeProvider = provider.id === "google" && !hasKey;
                const docsUrl = PROVIDER_DOCS[provider.id];

                return (
                  <div
                    key={provider.id}
                    className={`overflow-hidden rounded-(--md-shape-sm) transition-all duration-300 border ${isActive ? "bg-surface-high border-primary ring-1 ring-primary" : "bg-surface border-(--md-outline-variant)"}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSetActive(provider.id)}
                      aria-expanded={isActive}
                      className="flex items-center justify-between w-full px-3 py-2 bg-transparent border-none cursor-pointer text-foreground"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors duration-200 ${isActive ? "border-primary" : "border-outline"}`}
                        >
                          {isActive && (
                            <div
                              className="w-2.5 h-2.5 rounded-full animate-scale-in"
                              style={{ background: "var(--md-primary)" }}
                            />
                          )}
                        </div>
                        <span className="text-[13px] font-medium">{t(`provider.${provider.id}`)}</span>
                      </div>

                      {isFreeProvider ? (
                        <span
                          className="md-badge"
                          style={{
                            background: "var(--md-tertiary-container)",
                            color: "var(--md-on-tertiary-container)",
                          }}
                        >
                          <Check size={10} />
                          {t("settings.free")}
                        </span>
                      ) : hasKey ? (
                        <span
                          className="md-badge"
                          style={{
                            background: "var(--md-primary-container)",
                            color: "var(--md-on-primary-container)",
                          }}
                        >
                          <Check size={10} />
                          {t("settings.keySet")}
                        </span>
                      ) : null}
                      <ChevronDown
                        size={16}
                        className={isActive ? "text-primary rotate-180" : "text-secondary"}
                      />
                    </button>

                    {isActive && (
                      <div
                        className="px-3 pb-2.5"
                        style={{
                          borderTop: "1px solid var(--md-outline-variant)",
                          paddingTop: "8px",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="flex-1 flex items-center gap-2 overflow-hidden bg-surface-highest rounded-(--md-shape-sm) border border-(--md-outline-variant) px-2.5 h-9 transition-colors duration-200 focus-within:border-primary"
                          >
                          <Key size={12} className="text-secondary shrink-0" />
                          <input
                            type={showKeys[provider.id] ? "text" : "password"}
                            value={editingKeys[provider.id]}
                            onChange={(e) =>
                              setEditingKeys((prev) => ({
                                ...prev,
                                [provider.id]: e.target.value,
                              }))
                            }
                            placeholder={
                              provider.id === "lara"
                                ? t("settings.laraApiKey")
                                : provider.id === "custom"
                                  ? t("settings.customApiUrl")
                                  : provider.id === "bing"
                                    ? t("settings.bingApiKey")
                                    : provider.id === "baidu"
                                        ? t("settings.baiduApiKey")
                                        : provider.id === "aliyun"
                                          ? t("settings.aliyunApiKey")
                                          : t("settings.apiKey")
                            }
                            className="flex-1 text-xs focus:outline-none bg-transparent text-foreground border-none h-full"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowKeys((prev) => ({
                                ...prev,
                                [provider.id]: !prev[provider.id],
                              }))
                            }
                            className="text-secondary bg-transparent border-none cursor-pointer p-1 shrink-0"
                          >
                            {showKeys[provider.id] ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSaveKey(provider.id)}
                            disabled={
                              !(editingKeys[provider.id] || "").trim() ||
                              validating === provider.id
                            }
                            className="md-btn-tonal shrink-0 h-9 px-3.5 text-xs"
                          >
                          {validating === provider.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : validationResult[provider.id] === true ? (
                            <>
                              <Check size={14} />
                              {t("common.saved")}
                            </>
                          ) : validationResult[provider.id] === false ? (
                            t("common.invalid")
                          ) : (
                            t("common.save")
                          )}
                          </button>
                        </div>

                        <p className="mt-2 px-1 text-[11px] leading-relaxed text-secondary">
                        {t(`settings.${provider.id}Guide`)}
                        {docsUrl && (
                          <>
                            {" "}
                            <a
                              href={docsUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                openExternalLink(docsUrl);
                              }}
                              className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80"
                            >
                              {t("settings.openApiDocs")}
                              <ExternalLink size={11} />
                            </a>
                          </>
                        )}
                        </p>

                        {validationResult[provider.id] === false && (
                          <p className="text-xs mt-2 text-error">
                            {t("settings.invalidApiKey")}
                          </p>
                        )}
                        {validationResult[provider.id] === true && (
                          <p className="text-xs mt-2 text-primary">
                            {t("settings.keyValidated")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="md-divider" />

          <section>
            <h3 className="text-sm font-medium mb-4 text-primary tracking-wide">
              {t("settings.preferences")}
            </h3>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleDarkModeToggle}
                className="md-card flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3 text-sm text-foreground">
                  {darkMode ? <Moon size={18} /> : <Sun size={18} />}
                  {darkMode ? t("settings.darkTheme") : t("settings.lightTheme")}
                </div>
                <div className={`md-switch ${darkMode ? "on" : ""}`}>
                  <div className="md-switch-thumb" />
                </div>
              </button>

              <button
                onClick={handleAutostartToggle}
                className="md-card flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Monitor size={18} />
                  {t("settings.startOnStartup")}
                </div>
                <div className={`md-switch ${autostart ? "on" : ""}`}>
                  <div className="md-switch-thumb" />
                </div>
              </button>

              {autostartFailed && (
                <div className="text-[11px] text-error px-1">
                  {t("settings.autostartFailed")}
                </div>
              )}

              {autostart && (
                <button
                  onClick={handleStartMinimizedToggle}
                  className="md-card flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3 text-sm text-foreground">
                    <Minimize2 size={18} />
                    {t("settings.startMinimized")}
                  </div>
                  <div className={`md-switch ${startMinimized ? "on" : ""}`}>
                    <div className="md-switch-thumb" />
                  </div>
                </button>
              )}

              <div className="md-card flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <ZoomIn size={18} />
                  {t("settings.interfaceScale")}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleScale(uiScale - 0.1)}
                    className="md-icon-btn shrink-0"
                    title={t("settings.decrease")}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="text-xs font-mono text-secondary w-10 text-center">
                    {Math.round(uiScale * 100)}%
                  </span>
                  <button
                    onClick={() => handleScale(uiScale + 0.1)}
                    className="md-icon-btn shrink-0"
                    title={t("settings.increase")}
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    onClick={() => handleScale(1)}
                    className="md-btn-tonal h-9 px-3 text-xs"
                  >
                    {t("settings.reset")}
                  </button>
                </div>
              </div>

              <div className="md-card flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Eye size={18} />
                  {t("settings.uiOpacity")}
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="range"
                    min={MIN_UI_OPACITY}
                    max={MAX_UI_OPACITY}
                    step={1}
                    value={uiOpacity}
                    onChange={(event) => void handleOpacity(Number(event.target.value))}
                    aria-label={t("settings.uiOpacity")}
                    className="w-32 accent-(--md-primary)"
                  />
                  <span className="text-xs font-mono text-secondary w-10 text-right">
                    {uiOpacity}%
                  </span>
                </div>
              </div>

              <div className="md-card flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Volume2 size={18} />
                  {t("settings.speechVoice")}
                </div>
                <select
                  value={speechVoice}
                  onChange={(event) => void handleSpeechVoice(event.target.value)}
                  aria-label={t("settings.speechVoice")}
                  className="w-48 min-w-0 bg-surface-highest text-foreground border border-(--md-outline-variant) rounded-(--md-shape-sm) py-1.5 pl-3 pr-8 text-xs outline-none"
                >
                  <option value="">{t("settings.systemDefault")}</option>
                  {speechVoices.length > 0 ? (
                    speechVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))
                  ) : (
                    <option disabled>{t("settings.noSpeechVoices")}</option>
                  )}
                </select>
              </div>

              <div className="md-card flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <Gauge size={18} />
                  {t("settings.speechRate")}
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="range"
                    min={MIN_SPEECH_RATE}
                    max={MAX_SPEECH_RATE}
                    step={0.1}
                    value={speechRate}
                    onChange={(event) => void handleSpeechRate(Number(event.target.value))}
                    aria-label={t("settings.speechRate")}
                    className="w-32 accent-(--md-primary)"
                  />
                  <span className="text-xs font-mono text-secondary w-10 text-right">
                    {speechRate.toFixed(1)}x
                  </span>
                </div>
              </div>

              <div className="md-card flex items-center justify-between gap-4">
                <div className="text-sm text-foreground">
                  {t("settings.interfaceLanguage")}
                </div>
                <div className="w-40 shrink-0">
                  <LanguageSelector
                    value={locale}
                    onChange={(nextLocale) => {
                      void handleLocaleChange(nextLocale as Locale);
                    }}
                    options={[
                      { code: "en", label: t("settings.english") },
                      { code: "zh-CN", label: t("settings.simplifiedChinese") },
                    ]}
                    compact
                    usePortal={false}
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="md-divider" />

          <section>
            <h3 className="text-sm font-medium mb-4 text-primary tracking-wide">
              {t("settings.shortcut")}
            </h3>

            <div className="md-card flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-foreground">
                <Keyboard size={18} />
                {t("settings.openApp")}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRecordingHotkey(true)}
                  onKeyDown={handleHotkeyKeyDown}
                  onBlur={() => setRecordingHotkey(false)}
                  className="md-btn-tonal h-9 px-3.5 text-xs min-w-24 justify-center"
                >
                  {recordingHotkey
                    ? t("settings.pressKeys")
                    : openHotkey || t("settings.none")}
                </button>
                <button
                  onClick={() => applyOpenHotkey("")}
                  className="md-icon-btn shrink-0"
                  title={t("settings.clearShortcut")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="md-card flex items-center justify-between mt-2">
              <div className="flex items-center gap-3 text-sm text-foreground">
                <Copy size={18} />
                {t("settings.selectionTranslation")}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRecordingSelectionHotkey(true)}
                  onKeyDown={handleSelectionHotkeyKeyDown}
                  onBlur={() => setRecordingSelectionHotkey(false)}
                  className="md-btn-tonal h-9 px-3.5 text-xs min-w-24 justify-center"
                >
                  {recordingSelectionHotkey
                    ? t("settings.pressKeys")
                    : selectionHotkey || t("settings.none")}
                </button>
                <button
                  onClick={() => applySelectionHotkey("")}
                  className="md-icon-btn shrink-0"
                  title={t("settings.clearShortcut")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

          </section>

          <div className="md-divider" />

          <section>
            <h3 className="text-sm font-medium mb-4 text-primary tracking-wide">
              {t("settings.actions")}
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowChangelogModal(true)}
                className="md-card flex items-center gap-3 text-sm cursor-pointer text-foreground"
              >
                <FileText size={18} className="text-secondary" />
                {t("common.viewChangelog")}
              </button>

              <button
                onClick={handleClearData}
                className="md-card flex items-center gap-3 text-sm cursor-pointer text-error"
              >
                <Trash2 size={18} />
                {t("settings.clearAllData")}
              </button>
            </div>
          </section>

          <div className="pt-4 text-center text-xs font-mono border-t border-(--md-outline-variant) text-secondary tracking-widest">
            {t("app.name")} v{APP_VERSION}
          </div>
        </div>
      </div>
      
      <ChangelogModal 
        isOpen={showChangelogModal} 
        onClose={() => setShowChangelogModal(false)} 
      />
    </>
  );
}
