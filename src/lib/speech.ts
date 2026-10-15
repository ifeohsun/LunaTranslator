import { useSettingsStore } from "@/store/settingsStore";

export interface SpeechVoice {
  id: string;
  name: string;
}

export async function listSpeechVoices(): Promise<SpeechVoice[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SpeechVoice[]>("list_speech_voices");
}

export async function speakText(text: string) {
  const value = text.trim();
  if (!value) return;

  const { speechVoice, speechRate } = useSettingsStore.getState();

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("speak_text", {
      text: value,
      voiceId: speechVoice,
      rate: speechRate,
    });
    return;
  } catch (nativeError) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      throw nativeError;
    }
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.rate = speechRate;
  window.speechSynthesis.speak(utterance);
}

export async function stopSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_speech");
  } catch {
    // Browser speech was already cancelled; native speech may be unavailable.
  }
}
