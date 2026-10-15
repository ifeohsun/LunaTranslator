use std::sync::{mpsc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::State;

enum SpeechCommand {
    Speak {
        text: String,
        voice_id: String,
        rate: f64,
    },
    Stop,
}

#[derive(Clone, Serialize)]
pub struct SpeechVoice {
    pub id: String,
    pub name: String,
}

#[derive(Default)]
pub struct SpeechState {
    sender: Mutex<Option<mpsc::Sender<SpeechCommand>>>,
}

#[tauri::command]
pub fn list_speech_voices() -> Result<Vec<SpeechVoice>, String> {
    #[cfg(target_os = "windows")]
    {
        return thread::Builder::new()
            .name("luna-sapi-voices".to_string())
            .spawn(enumerate_speech_voices)
            .map_err(|error| format!("Failed to start voice enumeration: {error}"))?
            .join()
            .map_err(|_| "Voice enumeration thread stopped unexpectedly".to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn speak_text(
    state: State<'_, SpeechState>,
    text: String,
    voice_id: String,
    rate: f64,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }

    let sender = {
        let mut guard = state
            .sender
            .lock()
            .map_err(|_| "Speech service is unavailable".to_string())?;

        if let Some(sender) = guard.as_ref() {
            sender.clone()
        } else {
            let (sender, receiver) = mpsc::channel();
            thread::Builder::new()
                .name("luna-sapi-speech".to_string())
                .spawn(|| run_speech_worker(receiver))
                .map_err(|e| format!("Failed to start speech service: {e}"))?;
            *guard = Some(sender.clone());
            sender
        }
    };

    sender
        .send(SpeechCommand::Speak {
            text,
            voice_id,
            rate,
        })
        .map_err(|e| format!("Failed to queue speech: {e}"))
}

#[tauri::command]
pub fn stop_speech(state: State<'_, SpeechState>) -> Result<(), String> {
    let sender = state
        .sender
        .lock()
        .map_err(|_| "Speech service is unavailable".to_string())?
        .clone();

    if let Some(sender) = sender {
        sender
            .send(SpeechCommand::Stop)
            .map_err(|e| format!("Failed to stop speech: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn enumerate_speech_voices() -> Result<Vec<SpeechVoice>, String> {
    use windows::core::w;
    use windows::Win32::Media::Speech::ISpObjectToken;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    let init_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if init_result.is_err() {
        return Err(format!(
            "Failed to initialize COM for voice enumeration: HRESULT 0x{:08X}",
            init_result.0
        ));
    }

    let result = (|| unsafe {
        let category = create_voice_category()?;
        let tokens = category
            .EnumTokens(windows::core::PCWSTR::null(), windows::core::PCWSTR::null())
            .map_err(|error| format!("Failed to enumerate SAPI voices: {error}"))?;
        let mut voices = Vec::new();

        loop {
            let mut token: Option<ISpObjectToken> = None;
            let mut fetched = 0;
            if tokens.Next(1, &mut token, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }

            let Some(token) = token else {
                continue;
            };

            let id = match token.GetId() {
                Ok(pointer) => take_wide_string(pointer),
                Err(_) => continue,
            };
            if id.is_empty() {
                continue;
            }

            let name = token
                .GetStringValue(w!("Name"))
                .map(|pointer| take_wide_string(pointer))
                .unwrap_or_default();

            voices.push(SpeechVoice {
                id,
                name: if name.is_empty() {
                    "Windows voice".to_string()
                } else {
                    name
                },
            });
        }

        Ok(voices)
    })();

    unsafe { CoUninitialize() };
    result
}

#[cfg(target_os = "windows")]
unsafe fn create_voice_category(
) -> Result<windows::Win32::Media::Speech::ISpObjectTokenCategory, String> {
    use windows::core::w;
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Speech::ISpObjectTokenCategory;
    use windows::Win32::System::Com::{CLSIDFromProgID, CoCreateInstance, CLSCTX_ALL};

    let class_id = CLSIDFromProgID(w!("SAPI.SpObjectTokenCategory"))
        .map_err(|error| format!("Failed to locate SAPI voice category: {error}"))?;
    let category = CoCreateInstance::<_, ISpObjectTokenCategory>(&class_id, None, CLSCTX_ALL)
        .map_err(|error| format!("Failed to create SAPI voice category: {error}"))?;
    category
        .SetId(
            w!("HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech\\Voices"),
            BOOL(0),
        )
        .map_err(|error| format!("Failed to open SAPI voice category: {error}"))?;
    Ok(category)
}

#[cfg(target_os = "windows")]
unsafe fn find_voice_token(
    category: &windows::Win32::Media::Speech::ISpObjectTokenCategory,
    requested_voice_id: &str,
) -> Result<Option<windows::Win32::Media::Speech::ISpObjectToken>, String> {
    let target_id = if requested_voice_id.is_empty() {
        let pointer = category
            .GetDefaultTokenId()
            .map_err(|error| format!("Failed to get default SAPI voice: {error}"))?;
        take_wide_string(pointer)
    } else {
        requested_voice_id.to_string()
    };
    if target_id.is_empty() {
        return Ok(None);
    }

    let tokens = category
        .EnumTokens(windows::core::PCWSTR::null(), windows::core::PCWSTR::null())
        .map_err(|error| format!("Failed to enumerate SAPI voices: {error}"))?;
    loop {
        let mut token: Option<windows::Win32::Media::Speech::ISpObjectToken> = None;
        let mut fetched = 0;
        if tokens.Next(1, &mut token, Some(&mut fetched)).is_err() || fetched == 0 {
            return Ok(None);
        }

        let Some(token) = token else {
            continue;
        };
        let pointer = token
            .GetId()
            .map_err(|error| format!("Failed to read SAPI voice ID: {error}"))?;
        if take_wide_string(pointer) == target_id {
            return Ok(Some(token));
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn take_wide_string(pointer: windows::core::PWSTR) -> String {
    use windows::Win32::System::Com::CoTaskMemFree;

    if pointer.is_null() {
        return String::new();
    }

    let mut length = 0;
    while *pointer.0.add(length) != 0 {
        length += 1;
    }
    let value = String::from_utf16_lossy(std::slice::from_raw_parts(pointer.0, length));
    CoTaskMemFree(Some(pointer.0 as *const _));
    value
}

#[cfg(target_os = "windows")]
fn run_speech_worker(receiver: mpsc::Receiver<SpeechCommand>) {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Media::Speech::{ISpVoice, SVSFPurgeBeforeSpeak, SVSFlagsAsync};
    use windows::Win32::System::Com::{
        CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED,
    };

    let init_result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if init_result.is_err() {
        log::error!(
            "Failed to initialize COM for SAPI: HRESULT 0x{:08X}",
            init_result.0
        );
        return;
    }

    let voice = unsafe {
        CLSIDFromProgID(w!("SAPI.SpVoice"))
            .and_then(|class_id| CoCreateInstance::<_, ISpVoice>(&class_id, None, CLSCTX_ALL))
    };

    let voice = match voice {
        Ok(voice) => voice,
        Err(error) => {
            log::error!("Failed to create SAPI voice: {error}");
            unsafe { CoUninitialize() };
            return;
        }
    };

    let voice_category = unsafe { create_voice_category().ok() };
    let mut active_voice_id = String::new();

    while let Ok(command) = receiver.recv() {
        if matches!(&command, SpeechCommand::Stop) {
            let empty_text = [0u16];
            let flags = (SVSFPurgeBeforeSpeak.0 | SVSFlagsAsync.0) as u32;
            if let Err(error) =
                unsafe { voice.Speak(PCWSTR::from_raw(empty_text.as_ptr()), flags, None) }
            {
                log::warn!("Failed to stop SAPI speech: {error}");
            }
            continue;
        }

        let SpeechCommand::Speak {
            text,
            voice_id,
            rate,
        } = command
        else {
            continue;
        };

        let requested_voice_id = voice_id.trim().to_string();
        if requested_voice_id != active_voice_id {
            if let Some(category) = voice_category.as_ref() {
                match unsafe { find_voice_token(category, &requested_voice_id) } {
                    Ok(Some(token)) => match unsafe { voice.SetVoice(&token) } {
                        Ok(()) => active_voice_id = requested_voice_id,
                        Err(error) => log::warn!("Failed to select SAPI voice: {error}"),
                    },
                    Ok(None) => log::warn!("Configured SAPI voice was not found"),
                    Err(error) => log::warn!("Failed to find SAPI voice: {error}"),
                }
            }
        }

        let sapi_rate = rate_to_sapi(rate);
        if let Err(error) = unsafe { voice.SetRate(sapi_rate) } {
            log::warn!("Failed to set SAPI speech rate: {error}");
        }

        let wide_text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let flags = (SVSFPurgeBeforeSpeak.0 | SVSFlagsAsync.0) as u32;
        if let Err(error) =
            unsafe { voice.Speak(PCWSTR::from_raw(wide_text.as_ptr()), flags, None) }
        {
            log::error!("Failed to speak text with SAPI: {error}");
        }
    }

    unsafe { CoUninitialize() };
}

fn rate_to_sapi(rate: f64) -> i32 {
    let normalized = if rate.is_finite() { rate } else { 1.0 };
    (((normalized.clamp(0.5, 2.0) - 1.0) * 10.0).round() as i32).clamp(-10, 10)
}

#[cfg(not(target_os = "windows"))]
fn run_speech_worker(receiver: mpsc::Receiver<SpeechCommand>) {
    while receiver.recv().is_ok() {
        log::warn!("Windows SAPI speech is only available on Windows");
    }
}

#[cfg(test)]
mod tests {
    use super::rate_to_sapi;

    #[test]
    fn maps_speech_rate_to_sapi_range() {
        assert_eq!(rate_to_sapi(0.5), -5);
        assert_eq!(rate_to_sapi(1.0), 0);
        assert_eq!(rate_to_sapi(2.0), 10);
        assert_eq!(rate_to_sapi(10.0), 10);
    }
}
