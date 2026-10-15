import { create } from "zustand";

interface PopupState {
  clipboardText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  isTranslating: boolean;
  error: string | null;
  showKeyInput: boolean;
  keyInputValue: string;
  keySaveStatus: "idle" | "saving" | "success" | "error";
  translationRevision: number;

  setClipboardText: (text: string) => void;
  setSourceLang: (lang: string) => void;
  setTargetLang: (lang: string) => void;
  invalidateTranslation: () => void;
  beginTranslation: () => number;
  finishTranslation: (revision: number, text: string, error: string | null) => void;
  setError: (error: string | null) => void;
  setShowKeyInput: (show: boolean) => void;
  setKeyInputValue: (value: string) => void;
  setKeySaveStatus: (status: "idle" | "saving" | "success" | "error") => void;
  reset: () => void;
}

export const usePopupStore = create<PopupState>((set, get) => ({
  clipboardText: "",
  translatedText: "",
  sourceLang: "auto",
  targetLang: "auto",
  isTranslating: false,
  error: null,
  showKeyInput: false,
  keyInputValue: "",
  keySaveStatus: "idle",
  translationRevision: 0,

  setClipboardText: (text) => {
    get().invalidateTranslation();
    set({ clipboardText: text });
  },
  setSourceLang: (lang) => {
    if (get().sourceLang === lang) return;
    get().invalidateTranslation();
    set({ sourceLang: lang });
  },
  setTargetLang: (lang) => {
    if (get().targetLang === lang) return;
    get().invalidateTranslation();
    set({ targetLang: lang });
  },
  invalidateTranslation: () => set((state) => ({
    translationRevision: state.translationRevision + 1,
    translatedText: "", isTranslating: false, error: null,
  })),
  beginTranslation: () => {
    set((state) => ({ translationRevision: state.translationRevision + 1, isTranslating: true, error: null }));
    return get().translationRevision;
  },
  finishTranslation: (revision, text, error) => {
    if (get().translationRevision !== revision) return;
    set({ translatedText: text, error, isTranslating: false });
  },
  setError: (error: string | null) => set({ error }),
  setShowKeyInput: (show: boolean) => set({ showKeyInput: show }),
  setKeyInputValue: (value: string) => set({ keyInputValue: value }),
  setKeySaveStatus: (status) => set({ keySaveStatus: status }),
  reset: () =>
    set((state) => ({
      translationRevision: state.translationRevision + 1,
      isTranslating: false,
      clipboardText: "",
      translatedText: "",
      error: null,
      showKeyInput: false,
      keyInputValue: "",
      keySaveStatus: "idle",
    })),
}));
