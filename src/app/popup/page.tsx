"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { usePopupStore } from "@/store/popupStore";
import { useSettingsStore } from "@/store/settingsStore";
import { API_PROVIDERS, useTranslatorStore } from "@/store/translatorStore";
import {
  resolveTargetLanguage,
  translateText,
  validateApiKey,
} from "@/lib/translate";
import { loadCache } from "@/lib/settingsCache";
import LanguageSelector from "@/components/LanguageSelector";
import DropdownPortal from "@/components/DropdownPortal";
import { useI18n } from "@/lib/useI18n";
import { speakText, stopSpeech } from "@/lib/speech";
import {
  X,
  GripHorizontal,
  Copy,
  Check,
  Key,
  Loader2,
  ChevronUp,
  TriangleAlert,
  ArrowRightLeft,
  Pencil,
  Pin,
  PinOff,
  SquareArrowOutUpRight,
  Volume2,
} from "lucide-react";
import Image from "next/image";

interface SelectionSnapshot {
  revision: number;
  text: string;
  pending: boolean;
  visible: boolean;
  failed: boolean;
}

const POPUP_DEFAULT_WIDTH = 380;
const POPUP_DEFAULT_HEIGHT = 280;
const POPUP_MIN_WIDTH = 320;
const POPUP_MAX_WIDTH = 560;
const POPUP_MIN_HEIGHT = 250;
const POPUP_MAX_HEIGHT = 560;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function estimatePopupWidth(text: string, element: HTMLElement | null) {
  if (!text.trim()) return POPUP_DEFAULT_WIDTH;

  const style = window.getComputedStyle(element ?? document.body);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return POPUP_DEFAULT_WIDTH;

  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const longestLine = text.split(/\r?\n/).reduce(
    (longest, line) => Math.max(longest, context.measureText(line || " ").width),
    0
  );
  const desiredWidth = Math.ceil((longestLine + 40) / 8) * 8;

  return clamp(desiredWidth, POPUP_MIN_WIDTH, POPUP_MAX_WIDTH);
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function measureNaturalHeight(element: HTMLElement) {
  if (element instanceof HTMLTextAreaElement) {
    const previousHeight = element.style.height;
    element.style.height = "auto";
    const height = element.scrollHeight;
    element.style.height = previousHeight;
    return height;
  }

  return element.getBoundingClientRect().height;
}

async function resizePopupWindow(width: number, height: number) {
  const [{ getCurrentWindow, currentMonitor, PhysicalPosition }, { LogicalSize }] =
    await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/dpi"),
    ]);
  const popup = getCurrentWindow();
  const [position, currentSize, monitor] = await Promise.all([
    popup.outerPosition(),
    popup.outerSize(),
    currentMonitor(),
  ]);
  const scaleFactor = monitor?.scaleFactor ?? (await popup.scaleFactor());
  const nextSize = new LogicalSize(width, height);
  const nextPhysicalSize = nextSize.toPhysical(scaleFactor);

  let nextX = position.x + (currentSize.width - nextPhysicalSize.width) / 2;
  let nextY = position.y + (currentSize.height - nextPhysicalSize.height) / 2;

  if (monitor) {
    const area = monitor.workArea;
    const left = area.position.x;
    const top = area.position.y;
    const right = left + area.size.width - nextPhysicalSize.width;
    const bottom = top + area.size.height - nextPhysicalSize.height;
    nextX = clamp(nextX, left, Math.max(left, right));
    nextY = clamp(nextY, top, Math.max(top, bottom));
  }

  await popup.setSize(nextSize);
  try {
    await popup.setPosition(new PhysicalPosition(Math.round(nextX), Math.round(nextY)));
  } catch {
    // Keep the size update even when position permission is unavailable.
  }
}

export default function PopupPage() {
  const {
    clipboardText,
    translatedText,
    sourceLang,
    targetLang,
    isTranslating,
    error,
    showKeyInput,
    keyInputValue,
    keySaveStatus,
    setClipboardText,
    setSourceLang,
    setTargetLang,
    invalidateTranslation,
    beginTranslation,
    finishTranslation,
    setError,
    setShowKeyInput,
    setKeyInputValue,
    setKeySaveStatus,
    reset,
  } = usePopupStore();

  const {
    activeApi,
    apiKeys,
    setActiveApi,
    loadFromStore,
    uiOpacity,
    setApiKey,
    saveToStore,
  } = useSettingsStore();
  const { t, locale } = useI18n();

  const [copied, setCopied] = useState(false);
  const [isTranslatorSelectOpen, setIsTranslatorSelectOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [isSwapping, setIsSwapping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(-1);
  const selectionRevisionRef = useRef(-1);
  const selectionReadRef = useRef(0);
  const translatorSelectRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputTextareaRef = useRef<HTMLTextAreaElement>(null);
  const translatorBtnRef = useRef<HTMLButtonElement>(null);
  const translatorPortalRef = useRef<HTMLDivElement>(null);
  const popupRootRef = useRef<HTMLDivElement>(null);
  const popupResultRef = useRef<HTMLDivElement>(null);
  const resizeRequestRef = useRef(0);
  const retranslateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFreeMode = activeApi === "google" && !apiKeys.google.trim();
  const activeApiKey = apiKeys[activeApi];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const insideToggle = translatorSelectRef.current?.contains(target);
      const insidePortal = translatorPortalRef.current?.contains(target);
      if (!insideToggle && !insidePortal) {
        setIsTranslatorSelectOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      invalidateTranslation();
      void stopSpeech();
    };
  }, [invalidateTranslation]);

  useEffect(() => useSettingsStore.subscribe((state, previous) => {
    if (state.activeApi !== previous.activeApi || state.locale !== previous.locale ||
        state.apiKeys[state.activeApi] !== previous.apiKeys[previous.activeApi]) {
      invalidateTranslation();
    }
  }), [invalidateTranslation]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const refresh = async () => {
      if (disposed) return;
      const read = ++selectionReadRef.current;
      const { invoke } = await import("@tauri-apps/api/core");
      const snapshot = await invoke<SelectionSnapshot>("read_selection");
      if (disposed || read !== selectionReadRef.current || snapshot.revision <= selectionRevisionRef.current) return;
      reset();
      if (snapshot.visible) {
        await loadFromStore();
        try {
          const store = await loadCache();
          const [savedSource, savedTarget, mainTarget] = await Promise.all([
            store.get<string>("popupSourceLang"), store.get<string>("popupTargetLang"), store.get<string>("mainTargetLang"),
          ]);
          if (disposed || read !== selectionReadRef.current) return;
          if (savedSource) setSourceLang(savedSource);
          if (savedTarget) setTargetLang(savedTarget);
          else if (mainTarget) setTargetLang(mainTarget);
        } catch { /* Language preferences must not block selection delivery. */ }
      }
      if (disposed || read !== selectionReadRef.current) return;
      selectionRevisionRef.current = snapshot.revision;
      setSelectionRevision(snapshot.revision);
      setIsEditing(false);
      setIsEditingInput(false);
      setSelectionPending(snapshot.visible && snapshot.pending);
      if (!snapshot.visible) return;
      setClipboardText(snapshot.text);
      if (snapshot.failed) setError(t("popup.selectionFailed"));
    };
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.listen("popup-refresh", () => {
          void refresh().catch(console.error);
        });
        if (disposed) { unlisten(); return; }
        await refresh();
      } catch (error) {
        console.error("Failed to initialize selection popup:", error);
        if (!disposed) setError(t("popup.selectionFailed"));
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [invalidateTranslation, loadFromStore, reset, setClipboardText, setError, setSourceLang, setTargetLang, t]);

  const doTranslate = useCallback(async () => {
    const { clipboardText: text, sourceLang: from, targetLang: to } = usePopupStore.getState();
    if (!text.trim()) return;
    const revision = beginTranslation();
    const settingsState = useSettingsStore.getState();
    const api = settingsState.activeApi;
    const apiKey = settingsState.apiKeys[api];
    const isFree = api === "google" && !apiKey.trim();

    if (!apiKey && !isFree) {
      const provider = API_PROVIDERS.find((p) => p.id === api);
      finishTranslation(revision, "",
        t("popup.noApiKeyFor", {
          provider: provider ? t(`provider.${provider.id}`) : api,
        })
      );
      return;
    }

    setIsEditing(false);
    const targetLanguage = resolveTargetLanguage(
      text,
      to,
      locale,
      from
    );

    try {
      const result = await translateText(
        text,
        from,
        targetLanguage,
        api,
        apiKey,
        isFree
      );
      finishTranslation(revision, result.translatedText, null);
    } catch (e) {
      finishTranslation(revision, "", e instanceof Error ? e.message : String(e) || "Translation failed");
    }
  }, [beginTranslation, finishTranslation, locale, t]);

  useEffect(() => {
    if (clipboardText.trim()) {
      if (isEditingInput) {
        if (retranslateTimerRef.current) clearTimeout(retranslateTimerRef.current);
        retranslateTimerRef.current = setTimeout(() => {
          doTranslate();
        }, 600);
        return () => {
          if (retranslateTimerRef.current) clearTimeout(retranslateTimerRef.current);
        };
      } else {
        doTranslate();
      }
    }
  }, [clipboardText, sourceLang, targetLang, activeApi, activeApiKey, doTranslate, isEditingInput, locale, t, selectionRevision]);

  const handleCopy = async () => {
    const textToCopy = isEditing ? editText : translatedText;
    if (!textToCopy) return;
    try {
      const { writeText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
      await writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        console.error("Failed to copy");
      }
    }
  };

  const handleSpeak = async () => {
    const textToSpeak = isEditing ? editText : translatedText;
    if (!textToSpeak) return;
    try {
      await speakText(textToSpeak);
    } catch (error) {
      console.error("Failed to read translation aloud:", error);
    }
  };

  const closePopupWindow = useCallback(async () => {
    ++selectionReadRef.current;
    reset();
    setSelectionPending(false);
    void stopSpeech();
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("close_popup_window");
  }, [reset]);

  const handleReplace = async () => {
    const textToReplace = isEditing ? editText : translatedText;
    if (!textToReplace) return;
    try {
      try {
        const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeText(textToReplace);
      } catch {
        await navigator.clipboard.writeText(textToReplace);
      }
      await closePopupWindow();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("simulate_paste");
    } catch {
      console.error("Failed to replace");
    }
  };

  const handleClose = useCallback(async () => {
    try {
      await closePopupWindow();
    } catch {
      window.close();
    }
  }, [closePopupWindow]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const requestId = ++resizeRequestRef.current;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        const root = popupRootRef.current;
        const result = popupResultRef.current;
        if (!root || !result) return;

        const resultText = isEditing ? editText : translatedText || error || "";
        const resultTextElement = result.querySelector<HTMLElement>(
          "[data-popup-result-text]"
        );
        const width = estimatePopupWidth(resultText, resultTextElement);
        const currentHeight = Math.max(
          root.getBoundingClientRect().height || POPUP_DEFAULT_HEIGHT,
          POPUP_MIN_HEIGHT
        );

        try {
          await resizePopupWindow(width, currentHeight);
          if (requestId !== resizeRequestRef.current) return;

          await nextAnimationFrame();
          if (requestId !== resizeRequestRef.current) return;

          const fixedHeight = Array.from(root.children).reduce(
            (total, child) =>
              child === result ? total : total + child.getBoundingClientRect().height,
            0
          );
          const resultContent = result.querySelector<HTMLElement>(
            "[data-popup-result-content]"
          );
          const resultStyle = window.getComputedStyle(result);
          const resultPadding = [resultStyle.paddingTop, resultStyle.paddingBottom]
            .map(Number.parseFloat)
            .reduce((total, padding) => total + (Number.isFinite(padding) ? padding : 0), 0);
          const resultHeight = Math.max(
            (resultContent ? measureNaturalHeight(resultContent) : 0) + resultPadding,
            64
          );
          const height = clamp(
            Math.ceil(fixedHeight + resultHeight),
            POPUP_MIN_HEIGHT,
            POPUP_MAX_HEIGHT
          );

          await resizePopupWindow(width, height);
        } catch {
          // The page can also run outside Tauri during development.
        }
      })();
    });

    return () => cancelAnimationFrame(frame);
  }, [
    activeApi,
    clipboardText,
    editText,
    error,
    isEditing,
    isEditingInput,
    isTranslating,
    keySaveStatus,
    locale,
    showKeyInput,
    sourceLang,
    targetLang,
    translatedText,
  ]);

  const saveLangPref = async (key: string, val: string) => {
    try {
      const store = await loadCache();
      await store.set(key, val);
      await store.save();
    } catch {}
  };

  const handleSaveKey = async () => {
    if (!keyInputValue.trim()) return;

    setKeySaveStatus("saving");
    const isValid = await validateApiKey(activeApi, keyInputValue);

    if (isValid) {
      setApiKey(activeApi, keyInputValue);
      await saveToStore();
      setKeySaveStatus("success");
      setTimeout(() => {
        setShowKeyInput(false);
        setKeySaveStatus("idle");
        setKeyInputValue("");
        doTranslate();
      }, 2000);
    } else {
      setKeySaveStatus("error");
      setTimeout(() => setKeySaveStatus("idle"), 3000);
    }
  };

  const handleStartEdit = () => {
    setEditText(translatedText);
    setIsEditing(true);
    setTimeout(() => {
      editTextareaRef.current?.focus();
    }, 50);
  };

  const handleTogglePin = async () => {
    try {
      const newState = !isPinned;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_popup_pinned", { pinned: newState });
      setIsPinned(newState);
    } catch {
      console.error("Failed to toggle pin");
    }
  };

  const handleOpenMain = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { emit } = await import("@tauri-apps/api/event");
      
      const textToSet = (clipboardText && clipboardText !== t("common.couldNotReadClipboard")) ? clipboardText : "";
      if (textToSet) {
        await emit("set-main-text", { text: textToSet, sourceLang, targetLang });
      }
      
      await closePopupWindow();
      await invoke("open_main_window");
    } catch {
      console.error("Failed to open main window");
    }
  };

  return (
    <div
      ref={popupRootRef}
      className="flex flex-col select-none relative bg-surface text-foreground rounded-(--md-shape-sm) overflow-clip"
      style={{ height: "100vh", minHeight: 0, opacity: uiOpacity / 100 }}
    >
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2 shrink-0 bg-surface-high border-b border-(--md-outline-variant) rounded-t-(--md-shape-sm)"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <GripHorizontal size={14} className="text-secondary" />
          <Image
            src="/logo.svg"
            width={20}
            height={20}
            alt=""
            className="h-5 w-5 shrink-0 object-contain"
          />
          <span
            className="text-xs font-medium tracking-wide"
            data-tauri-drag-region
          >
            {t("app.name")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleTogglePin}
            className={`md-icon-btn w-7 h-7 ${isPinned ? "text-primary" : "text-secondary"}`}
            title={isPinned ? t("common.unpinWindow") : t("common.pinWindow")}
          >
            {isPinned ? <Pin size={14} className="fill-current" /> : <PinOff size={14} />}
          </button>
          <button
            onClick={handleOpenMain}
            className="md-icon-btn w-7 h-7"
            title={t("common.openMain")}
          >
            <SquareArrowOutUpRight size={14} />
          </button>
          <button
            onClick={handleClose}
            className="md-icon-btn w-7 h-7"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div
        className="flex items-center gap-2 px-4 py-2.5 shrink-0 border-b border-(--md-outline-variant) relative"
        style={{ zIndex: 30 }}
      >
        <div className={`flex-1 z-10 ${!isResetting ? "transition-all duration-300 ease-in-out" : ""} ${isSwapping ? "translate-x-49" : "translate-x-0"}`}>
          <LanguageSelector
            value={sourceLang}
            onChange={(val) => {
              setSourceLang(val);
              saveLangPref("popupSourceLang", val);
            }}
            showAutoDetect
            compact
          />
        </div>
        <button
          onClick={() => {
            if (isSwapping) return;
            setIsSwapping(true);
            
            setTimeout(() => {
              setIsSwapping(false);
              setIsResetting(true);
              const temp = sourceLang;
              setSourceLang(targetLang);
              setTargetLang(temp);
              saveLangPref("popupSourceLang", targetLang);
              saveLangPref("popupTargetLang", temp);
              
              setTimeout(() => {
                setIsResetting(false);
              }, 50);
            }, 300);
          }}
          disabled={sourceLang === "auto"}
          className={`md-icon-btn w-7 h-7 shrink-0 z-0 ${!isResetting ? "transition-all duration-300" : ""} ${isSwapping ? "rotate-180 scale-90 opacity-40" : "hover:scale-110"}`}
          title={t("common.swapLanguages")}
        >
          <ArrowRightLeft size={14} />
        </button>
        <div className={`flex-1 z-10 ${!isResetting ? "transition-all duration-300 ease-in-out" : ""} ${isSwapping ? "-translate-x-49" : "translate-x-0"}`}>
          <LanguageSelector
            value={targetLang}
            onChange={(val) => {
              setTargetLang(val);
              saveLangPref("popupTargetLang", val);
            }}
            showAutoTarget
            compact
          />
        </div>
      </div>

      <div
        className="px-4 py-2.5 max-h-20 overflow-y-auto shrink-0 bg-surface-low border-b border-(--md-outline-variant) group relative"
      >
        {isEditingInput ? (
          <textarea
            ref={inputTextareaRef}
            value={clipboardText}
            onChange={(e) => {
              setClipboardText(e.target.value);
              // auto-resize to fit
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }}
            onBlur={() => {
              if (!clipboardText.trim()) setIsEditingInput(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsEditingInput(false);
              }
            }}
            className="w-full leading-snug text-xs text-secondary bg-transparent border-none outline-none resize-none select-text"
            rows={1}
            autoFocus
            onFocus={(e) => {
              // auto-resize on focus
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            }}
          />
        ) : (
          <p
            className="leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs text-secondary cursor-text select-text"
            onClick={() => {
              if (selectionPending) return;
              setIsEditingInput(true);
              setTimeout(() => inputTextareaRef.current?.focus(), 50);
            }}
          >
            {selectionPending ? t("popup.readingSelection") : clipboardText || t("popup.noSelection")}
          </p>
        )}
      </div>

      <div
        ref={popupResultRef}
        className="flex-1 px-4 py-3 overflow-y-auto min-h-0"
      >
        {isTranslating ? (
          <div data-popup-result-content className="flex flex-col gap-2">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-3/4" />
          </div>
        ) : error ? (
          <div
            data-popup-result-content
            className="flex flex-col gap-2 p-3 text-xs bg-error-container text-error border border-error/20 rounded-(--md-shape-sm)"
          >
            <div className="flex items-start gap-2">
              <TriangleAlert size={16} className="shrink-0 mt-0.5" />
              <span className="leading-snug wrap-break-word">{error}</span>
            </div>
            <div className="pl-5">
              <a 
                onClick={(e) => {
                  e.preventDefault();
                   import("@tauri-apps/plugin-shell").then(({ open }) => open("https://github.com/ifeohsun/Translator/issues")).catch(() => window.open("https://github.com/ifeohsun/Translator/issues", "_blank"));
                }}
                className="underline opacity-90 hover:opacity-100 transition-opacity text-[11px] text-error cursor-pointer"
              >
                {t("common.reportIssue")}
              </a>
            </div>
          </div>
        ) : isEditing ? (
          <textarea
            ref={editTextareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            data-popup-result-content
            data-popup-result-text
            className="w-full h-full leading-snug text-[13px] text-foreground bg-transparent border-none outline-none resize-none"
          />
        ) : (
          <div data-popup-result-content className="flex items-start gap-2">
            <p
              data-popup-result-text
              className="leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[13px] text-foreground flex-1 min-w-0"
            >
              {translatedText}
            </p>
            {translatedText && (
              <button
                onClick={handleStartEdit}
                className="md-icon-btn w-6 h-6 shrink-0 mt-px"
                title={t("common.editTranslation")}
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {showKeyInput && !isFreeMode && (
        <div
          className="px-4 py-2.5 shrink-0 bg-surface-high border-t border-(--md-outline-variant)"
        >
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={keyInputValue}
              onChange={(e) => setKeyInputValue(e.target.value)}
              placeholder={activeApi === "lara" ? t("popup.laraKeyPlaceholder") : t("popup.keyPlaceholder")}
              className="flex-1 text-xs focus:outline-none bg-surface-highest text-foreground border border-(--md-outline-variant) rounded-(--md-shape-sm) px-3 py-2"
              autoFocus
              data-form-type="other"
            />
            <button
              onClick={handleSaveKey}
              disabled={keySaveStatus === "saving"}
              className="md-btn-tonal h-8 px-3 text-[11px] rounded-(--md-shape-sm)"
            >
              {keySaveStatus === "saving" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : keySaveStatus === "success" ? (
                <span className="flex items-center gap-1"><Check size={12} /> {t("common.saved")}</span>
              ) : keySaveStatus === "error" ? (
                <span className="flex items-center gap-1"><X size={12} /> {t("common.invalid")}</span>
              ) : (
                t("common.save")
              )}
            </button>
            <button
              onClick={() => {
                setShowKeyInput(false);
                setKeyInputValue("");
                setKeySaveStatus("idle");
              }}
              className="text-xs text-secondary bg-transparent border-none cursor-pointer py-1 px-2"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 bg-surface-high border-t border-(--md-outline-variant) rounded-b-(--md-shape-sm)"
      >
        <div className="flex items-center gap-2">
          <div ref={translatorSelectRef} className="relative">
            <button
              ref={translatorBtnRef}
              onClick={() => {
                const newState = !isTranslatorSelectOpen;
                setIsTranslatorSelectOpen(newState);
              }}
              className="flex items-center justify-between font-medium outline-none state-layer gap-2 cursor-pointer bg-surface-high text-secondary border border-(--md-outline-variant) rounded-(--md-shape-sm) py-1.5 pl-3 pr-2 text-xs transition-all"
            >
              <span>
                {API_PROVIDERS.find((p) => p.id === activeApi)
                  ? t(`provider.${activeApi}`)
                  : t("common.selectApi")}
              </span>
              <ChevronUp
                size={14}
                className={`text-secondary transition-transform duration-200 ${
                  isTranslatorSelectOpen ? "rotate-0" : "rotate-180"
                }`}
              />
            </button>

            <DropdownPortal
              anchorRef={translatorBtnRef}
              isOpen={isTranslatorSelectOpen}
              minWidth={144}
            >
              <div ref={translatorPortalRef}>
                <div
                  className={`overflow-hidden shadow-xl transition-all duration-200 ease-out origin-bottom border border-(--md-outline-variant) bg-surface-highest rounded-(--md-shape-sm) ${
                    isTranslatorSelectOpen
                      ? "max-h-50 opacity-100 pointer-events-auto"
                      : "max-h-0 opacity-0 pointer-events-none"
                  }`}
                >
                  <div className="flex flex-col py-1 px-1">
                    {API_PROVIDERS.map((p) => {
                      const isSelected = activeApi === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={async () => {
                            useTranslatorStore.getState().setActiveApi(p.id);
                            setActiveApi(p.id);
                            await saveToStore();
                            setIsTranslatorSelectOpen(false);
                          }}
                          className={`flex items-center justify-between px-3 py-2 mb-0.5 rounded-full text-left w-full hover:bg-[rgba(255,255,255,0.08)] transition-colors text-xs ${
                            isSelected
                              ? "text-primary font-semibold"
                              : "text-foreground font-normal"
                          }`}
                        >
                          {t(`provider.${p.id}`)}
                          {isSelected && <Check size={14} className="text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </DropdownPortal>
          </div>
          
          {!isFreeMode && (
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className="md-icon-btn w-7 h-7"
            >
              <Key size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleSpeak}
            disabled={!translatedText && !editText}
            className={`md-chip h-7 px-3 text-[11px] whitespace-nowrap shrink-0 max-[520px]:w-8 max-[520px]:!px-0 max-[520px]:!gap-0 max-[520px]:justify-center ${!translatedText && !editText ? "opacity-38" : ""}`}
            title={t("common.readAloud")}
          >
            <Volume2 size={12} className="shrink-0" />
            <span className="whitespace-nowrap max-[520px]:hidden">{t("common.readAloud")}</span>
          </button>
          <button
            onClick={handleReplace}
            disabled={!translatedText && !editText}
            className={`md-chip h-7 px-3 text-[11px] whitespace-nowrap shrink-0 max-[520px]:w-8 max-[520px]:!px-0 max-[520px]:!gap-0 max-[520px]:justify-center ${!translatedText && !editText ? "opacity-38" : ""}`}
            title={t("common.replace")}
          >
            <ArrowRightLeft size={12} className="shrink-0" />
            <span className="whitespace-nowrap max-[520px]:hidden">{t("common.replace")}</span>
          </button>
          <button
            onClick={handleCopy}
            disabled={!translatedText && !editText}
            className={`md-chip h-7 px-3 text-[11px] whitespace-nowrap shrink-0 max-[520px]:w-8 max-[520px]:!px-0 max-[520px]:!gap-0 max-[520px]:justify-center ${!translatedText && !editText ? "opacity-38" : ""}`}
            title={copied ? t("common.copied") : t("common.copy")}
            style={copied ? {
              background: "var(--md-primary-container)",
              color: "var(--md-on-primary-container)",
              borderColor: "transparent",
            } : undefined}
          >
            {copied ? <Check size={12} className="shrink-0" /> : <Copy size={12} className="shrink-0" />}
            <span className="whitespace-nowrap max-[520px]:hidden">
              {copied ? t("common.copied") : t("common.copy")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
