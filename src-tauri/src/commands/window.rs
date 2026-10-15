use tauri::{AppHandle, Manager};

const PASTE_INIT_DELAY_MS: u64 = 300;
const PASTE_MODIFIER_DELAY_MS: u64 = 20;
const PASTE_KEY_HOLD_MS: u64 = 30;
#[cfg(not(target_os = "windows"))]
const COPY_INIT_DELAY_MS: u64 = 160;

#[cfg(target_os = "windows")]
fn wait_for_copy_modifiers(
    mut modifiers_pressed: impl FnMut() -> bool,
    mut check_source: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        check_source()?;
        if !modifiers_pressed() {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err("Release the shortcut modifiers before translating selection".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[cfg(all(test, target_os = "windows"))]
#[test]
fn copy_waits_for_modifiers_on_every_invocation() {
    use std::time::{Duration, Instant};

    for _ in 0..2 {
        let released_at = Instant::now() + Duration::from_millis(180);
        wait_for_copy_modifiers(|| Instant::now() < released_at, || Ok(())).unwrap();
        assert!(Instant::now() >= released_at);
    }
    assert!(wait_for_copy_modifiers(|| false, || Ok(())).is_ok());
    assert!(wait_for_copy_modifiers(|| true, || Ok(())).is_err());
    assert!(wait_for_copy_modifiers(|| true, || Err("cancelled".into())).is_err());
}

#[tauri::command]
pub async fn close_popup_window(app: AppHandle) -> Result<(), String> {
    let id = {
        let state = app.state::<crate::selection::SelectionState>();
        let mut snapshot = state.snapshot.lock().map_err(|e| e.to_string())?;
        snapshot.cancel();
        snapshot.id
    };
    let (done, closed) = tokio::sync::oneshot::channel();
    let ah = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let state = ah.state::<crate::selection::SelectionState>();
            let snapshot = state.snapshot.lock().map_err(|e| e.to_string())?;
            if snapshot.id == id {
                if let Some(popup) = ah.get_webview_window("popup") {
                    #[cfg(target_os = "windows")]
                    let _ = popup.set_skip_taskbar(true);
                    popup.hide().map_err(|e| e.to_string())?;
                    use tauri::Emitter;
                    let _ = popup.emit("popup-refresh", ());
                }
            }
            Ok(())
        })();
        let _ = done.send(result);
    })
    .map_err(|e| e.to_string())?;
    closed.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window
            .hide()
            .inspect_err(|e| log::warn!("Failed to hide main window: {}", e));

        #[cfg(target_os = "windows")]
        let _ = window.set_skip_taskbar(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();

        #[cfg(target_os = "windows")]
        let _ = window.set_skip_taskbar(false);

        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn set_main_zoom(app: AppHandle, factor: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_zoom(factor)
            .map_err(|e| format!("Failed to set zoom: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_popup_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup
            .set_always_on_top(pinned)
            .inspect_err(|e| log::warn!("Failed to set always on top: {}", e));

        #[cfg(target_os = "windows")]
        let _ = popup.set_skip_taskbar(pinned);
    }
    Ok(())
}

#[tauri::command]
pub async fn simulate_paste() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WAYLAND_DISPLAY").is_ok() {
            return simulate_paste_wayland();
        }
    }

    use rdev::{simulate, EventType, Key};
    use std::thread;
    use std::time::Duration;

    thread::sleep(Duration::from_millis(PASTE_INIT_DELAY_MS));

    #[cfg(target_os = "macos")]
    let modifier = Key::MetaLeft;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::ControlLeft;

    simulate(&EventType::KeyPress(modifier))
        .map_err(|e| format!("Failed to press modifier: {:?}", e))?;

    thread::sleep(Duration::from_millis(PASTE_MODIFIER_DELAY_MS));
    simulate(&EventType::KeyPress(Key::KeyV)).map_err(|e| format!("Failed to press V: {:?}", e))?;
    thread::sleep(Duration::from_millis(PASTE_KEY_HOLD_MS));
    simulate(&EventType::KeyRelease(Key::KeyV))
        .map_err(|e| format!("Failed to release V: {:?}", e))?;
    simulate(&EventType::KeyRelease(modifier))
        .map_err(|e| format!("Failed to release modifier: {:?}", e))?;

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn simulate_copy_selection(
    check_source: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    // The shortcut's letter can be released while a modifier or selection drag is still held.
    wait_for_copy_modifiers(
        || {
            [
                VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_LBUTTON, VK_RBUTTON,
            ]
            .iter()
            .any(|key| unsafe { GetAsyncKeyState(key.0 as i32) < 0 })
        },
        check_source,
    )?;

    let key = |vk, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    // Submit the complete chord together so rapid user input cannot split Ctrl+C.
    let inputs = [
        key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        key(VK_C, KEYBD_EVENT_FLAGS(0)),
        key(VK_C, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    if unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) } != inputs.len() as u32 {
        let _ = unsafe { SendInput(&inputs[2..], std::mem::size_of::<INPUT>() as i32) };
        return Err("Failed to send selection copy keys".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_copy_selection(
    mut check_source: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use rdev::{simulate, EventType, Key};
    use std::thread;
    use std::time::Duration;

    thread::sleep(Duration::from_millis(COPY_INIT_DELAY_MS));

    check_source()?;

    #[cfg(target_os = "macos")]
    let modifier = Key::MetaLeft;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::ControlLeft;

    simulate(&EventType::KeyPress(modifier))
        .map_err(|e| format!("Failed to press modifier: {:?}", e))?;
    thread::sleep(Duration::from_millis(PASTE_MODIFIER_DELAY_MS));
    simulate(&EventType::KeyPress(Key::KeyC)).map_err(|e| format!("Failed to press C: {:?}", e))?;
    thread::sleep(Duration::from_millis(PASTE_KEY_HOLD_MS));
    simulate(&EventType::KeyRelease(Key::KeyC))
        .map_err(|e| format!("Failed to release C: {:?}", e))?;
    simulate(&EventType::KeyRelease(modifier))
        .map_err(|e| format!("Failed to release modifier: {:?}", e))?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn simulate_paste_wayland() -> Result<(), String> {
    use std::process::Command;

    std::thread::sleep(std::time::Duration::from_millis(PASTE_INIT_DELAY_MS));

    if let Ok(status) = Command::new("wtype")
        .args(["-M", "ctrl", "-k", "v", "-m", "ctrl"])
        .status()
    {
        if status.success() {
            return Ok(());
        }
    }

    if let Ok(status) = Command::new("ydotool")
        .args(["key", "29:1", "47:1", "47:0", "29:0"])
        .status()
    {
        if status.success() {
            return Ok(());
        }
    }

    Err(
        "Paste requires an X11 session, or the 'wtype' or 'ydotool' tool installed \
         on Wayland. Install one with: sudo apt install wtype"
            .into(),
    )
}
