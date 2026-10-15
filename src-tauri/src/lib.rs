use std::sync::Mutex;
use tauri::Emitter;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod commands;
mod selection;
use selection::{SelectionSnapshot, SelectionState};

struct OpenHotkey(Mutex<Option<String>>);

struct SelectionHotkey(Mutex<Option<String>>);

const DEFAULT_OPEN_HOTKEY: &str = "Ctrl+Shift+T";
const DEFAULT_SELECTION_HOTKEY: &str = "Ctrl+Alt+Y";
const LEGACY_SELECTION_HOTKEY: &str = "Ctrl+Shift+Y";
const AUTOSTART_ARG: &str = "--autostart";
const POPUP_WIDTH: f64 = 380.0;
const POPUP_HEIGHT: f64 = 280.0;
const CARET_GAP: i32 = 8;
const CARET_LINE_HEIGHT_ESTIMATE: i32 = 20;

fn show_and_focus_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        // fix app close??
        #[cfg(target_os = "windows")]
        let _ = window.set_skip_taskbar(false);

        let _ = window.unminimize();
        let _ = window
            .show()
            .inspect_err(|e| log::warn!("Failed to show window {label}: {e}"));
        let _ = window
            .set_focus()
            .inspect_err(|e| log::warn!("Failed to focus window {label}: {e}"));
    }
}

fn focus_main_input(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window
            .emit("focus-input", ())
            .inspect_err(|e| log::warn!("Failed to emit focus-input: {e}"));
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);

        if visible && focused {
            let _ = window
                .hide()
                .inspect_err(|e| log::warn!("Failed to hide main window: {e}"));

            #[cfg(target_os = "windows")]
            let _ = window.set_skip_taskbar(true);
        } else {
            show_and_focus_window(app, "main");
            focus_main_input(app);
        }
    }
}

fn read_open_hotkey(app: &AppHandle) -> String {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("settings.json"),
        Err(_) => return DEFAULT_OPEN_HOTKEY.to_string(),
    };

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return DEFAULT_OPEN_HOTKEY.to_string(),
    };

    serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|json| {
            json.get("openHotkey")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| DEFAULT_OPEN_HOTKEY.to_string())
}

fn read_selection_hotkey(app: &AppHandle) -> String {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("settings.json"),
        Err(_) => return DEFAULT_SELECTION_HOTKEY.to_string(),
    };

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return DEFAULT_SELECTION_HOTKEY.to_string(),
    };

    serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|json| {
            json.get("selectionHotkey")
                .and_then(|v| v.as_str())
                .map(|hotkey| {
                    if hotkey == LEGACY_SELECTION_HOTKEY {
                        DEFAULT_SELECTION_HOTKEY.to_string()
                    } else {
                        hotkey.to_string()
                    }
                })
        })
        .unwrap_or_else(|| DEFAULT_SELECTION_HOTKEY.to_string())
}

fn read_start_minimized(app: &AppHandle) -> bool {
    let path = match app.path().app_config_dir() {
        Ok(dir) => dir.join("settings.json"),
        Err(_) => return false,
    };

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|json| json.get("startMinimized").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

fn apply_open_hotkey(app: &AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();

    if let Some(state) = app.try_state::<OpenHotkey>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(prev) = guard.take() {
                let _ = gs.unregister(prev.as_str());
            }
        }
    }

    let accel = accel.trim();
    if accel.is_empty() {
        return Ok(());
    }

    gs.on_shortcut(accel, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_main_window(app);
        }
    })
    .map_err(|e| format!("Failed to register shortcut '{accel}': {e}"))?;

    if let Some(state) = app.try_state::<OpenHotkey>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(accel.to_string());
        }
    }

    Ok(())
}

#[tauri::command]
fn set_open_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    apply_open_hotkey(&app, &accelerator)
}

fn apply_selection_hotkey(app: &AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();

    if let Some(state) = app.try_state::<SelectionHotkey>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(prev) = guard.take() {
                let _ = gs.unregister(prev.as_str());
            }
        }
    }

    let accel = accel.trim();
    if accel.is_empty() {
        return Ok(());
    }

    gs.on_shortcut(accel, |app, _shortcut, event| {
        if event.state == ShortcutState::Released {
            let source = selection_source();
            if let Some(popup) = app.get_webview_window("popup") {
                #[cfg(target_os = "windows")]
                let from_popup = popup.hwnd().is_ok_and(|hwnd| hwnd.0 as isize == source);
                #[cfg(not(target_os = "windows"))]
                let from_popup = popup.is_focused().unwrap_or(false);
                if from_popup {
                    return;
                }
            }
            let state = app.state::<SelectionState>();
            let Ok(mut snapshot) = state.snapshot.lock() else {
                return;
            };
            let id = snapshot.begin();
            drop(snapshot);
            let ah = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = open_selection_popup(&ah, id, source).await {
                    if ah
                        .state::<SelectionState>()
                        .snapshot
                        .lock()
                        .is_ok_and(|snapshot| snapshot.is_current(id))
                    {
                        log::warn!("Selection {id}: {e}");
                        finish_selection(&ah, id, source, String::new(), true);
                    }
                }
            });
        }
    })
    .map_err(|e| format!("Failed to register selection shortcut '{accel}': {e}"))?;

    if let Some(state) = app.try_state::<SelectionHotkey>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(accel.to_string());
        }
    }

    Ok(())
}

#[tauri::command]
fn set_selection_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    apply_selection_hotkey(&app, &accelerator)
}

#[tauri::command]
fn read_selection(app: AppHandle) -> Result<SelectionSnapshot, String> {
    app.state::<SelectionState>()
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_and_focus_window(app, "main");
        focus_main_input(app);
    }));

    builder
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .manage(OpenHotkey(Mutex::new(None)))
        .manage(SelectionHotkey(Mutex::new(None)))
        .manage(SelectionState::default())
        .manage(commands::speech::SpeechState::default())
        .invoke_handler(tauri::generate_handler![
            commands::translate::translate_text,
            commands::translate::validate_api_key,
            commands::speech::speak_text,
            commands::speech::stop_speech,
            commands::speech::list_speech_voices,
            commands::window::close_popup_window,
            commands::window::hide_main_window,
            commands::window::open_main_window,
            commands::window::set_main_zoom,
            commands::window::set_popup_pinned,
            commands::window::simulate_paste,
            commands::store::save_settings,
            commands::store::load_settings,
            set_open_hotkey,
            set_selection_hotkey,
            read_selection,
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Ok(display_backend) = std::env::var("XDG_SESSION_TYPE") {
                if display_backend == "wayland" {
                    log::info!("Running on a Wayland session: some features (global shortcut, caret positioning) are limited. The 'wtype' or 'ydotool' tool is needed for the Replace feature.");
                }
            }

            // Entries registered before AUTOSTART_ARG existed carry no arguments,
            // so rewrite them once the app knows autostart is on.
            let autolaunch = app.autolaunch();
            if autolaunch.is_enabled().unwrap_or(false) {
                let _ = autolaunch
                    .enable()
                    .inspect_err(|e| log::warn!("Failed to refresh autostart entry: {e}"));
            }

            let launched_by_autostart = std::env::args().any(|arg| arg == AUTOSTART_ARG);

            if launched_by_autostart && read_start_minimized(app.handle()) {
                #[cfg(target_os = "windows")]
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_skip_taskbar(true);
                }
            } else {
                show_and_focus_window(app.handle(), "main");
            }

            let open_item = MenuItemBuilder::with_id("open", "Open LunaTranslator").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&settings_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("LunaTranslator")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        show_and_focus_window(app, "main");
                        focus_main_input(app);
                    }
                    "settings" => {
                        show_and_focus_window(app, "main");
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window
                                .eval("window.location.hash = '#settings'")
                                .inspect_err(|e| log::warn!("Failed to eval: {e}"));
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_and_focus_window(tray.app_handle(), "main");
                        focus_main_input(tray.app_handle());
                    }
                })
                .build(app)?;

            let open_hotkey = read_open_hotkey(app.handle());
            if let Err(e) = apply_open_hotkey(app.handle(), &open_hotkey) {
                log::warn!("Failed to register open hotkey: {e}");
            }

            let selection_hotkey = read_selection_hotkey(app.handle());
            if let Err(e) = apply_selection_hotkey(app.handle(), &selection_hotkey) {
                log::warn!("Failed to register selection hotkey: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "popup" {
                    if let Ok(mut snapshot) = window.state::<SelectionState>().snapshot.lock() {
                        snapshot.cancel();
                    }
                }
                if window.label() == "main" {
                    api.prevent_close();

                    let win = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = win
                            .hide()
                            .inspect_err(|e| log::warn!("Failed to hide main window: {e}"));

                        #[cfg(target_os = "windows")]
                        let _ = win.set_skip_taskbar(true);
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn selection_source() -> isize {
    #[cfg(target_os = "windows")]
    return unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize };
    #[cfg(not(target_os = "windows"))]
    0
}

fn source_is_current(source: isize) -> bool {
    #[cfg(target_os = "windows")]
    return source != 0 && selection_source() == source;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = source;
        true
    }
}

fn finish_selection(app: &AppHandle, id: u64, source: isize, text: String, failed: bool) {
    let ah = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = ah.state::<SelectionState>();
        let Ok(mut snapshot) = state.snapshot.lock() else {
            return;
        };
        if !snapshot.finish(id, text, failed) {
            return;
        }
        if let Some(popup) = ah.get_webview_window("popup") {
            let _ = popup.emit("popup-refresh", ());
            if source_is_current(source) && !failed {
                let _ = popup.set_focus();
            }
        }
    });
}

async fn open_selection_popup(app: &AppHandle, id: u64, source: isize) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let state = app.state::<SelectionState>();
    let _capture = state.capture.lock().await;
    if !state
        .snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .is_current(id)
    {
        return Ok(());
    }
    let started = std::time::Instant::now();
    open_popup(app, id).map_err(|e| e.to_string())?;

    let ah = app.clone();
    let sequence = tauri::async_runtime::spawn_blocking(move || {
        let mut sequence = 0;
        commands::window::simulate_copy_selection(|| {
            if !ah
                .state::<SelectionState>()
                .snapshot
                .lock()
                .map_err(|e| e.to_string())?
                .is_current(id)
            {
                return Err("Selection request superseded or closed".into());
            }
            if !source_is_current(source) {
                return Err("Selection source window changed".into());
            }
            #[cfg(target_os = "windows")]
            {
                sequence =
                    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() };
            }
            #[cfg(not(target_os = "windows"))]
            ah.clipboard().clear().map_err(|e| e.to_string())?;
            Ok(())
        })?;
        Ok::<u32, String>(sequence)
    })
    .await
    .map_err(|e| e.to_string())??;

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(800);
    let mut read_failed = false;
    loop {
        if !state
            .snapshot
            .lock()
            .map_err(|e| e.to_string())?
            .is_current(id)
        {
            return Ok(());
        }
        if !source_is_current(source) {
            return Err("Selection source window changed while copying".into());
        }
        #[cfg(target_os = "windows")]
        let changed = unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
            != sequence;
        #[cfg(not(target_os = "windows"))]
        let changed = {
            let _ = sequence;
            true
        };
        if changed {
            match app.clipboard().read_text() {
                Ok(text) => {
                    log::info!(
                        "Selection {id}: captured in {} ms",
                        started.elapsed().as_millis()
                    );
                    finish_selection(app, id, source, text, false);
                    return Ok(());
                }
                Err(_) => read_failed = true,
            }
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    log::info!(
        "Selection {id}: {} after {} ms",
        if read_failed {
            "clipboard unavailable"
        } else {
            "no selection"
        },
        started.elapsed().as_millis()
    );
    finish_selection(app, id, source, String::new(), read_failed);
    Ok(())
}

fn open_popup(app: &AppHandle, id: u64) -> Result<(), Box<dyn std::error::Error>> {
    let (target_x, target_y) = if let Some((caret_x, caret_y)) = commands::cursor::get_caret_pos() {
        let bounds = commands::cursor::get_screen_bounds(app, caret_x, caret_y);
        let popup_w = (POPUP_WIDTH * bounds.scale_factor) as i32;
        let popup_h = (POPUP_HEIGHT * bounds.scale_factor) as i32;

        let mut x = caret_x - popup_w / 2;
        x = x.max(bounds.left).min(bounds.right - popup_w);

        let y_below = caret_y + CARET_GAP;
        let y_above = caret_y - CARET_LINE_HEIGHT_ESTIMATE - CARET_GAP - popup_h;

        let y = if y_below + popup_h <= bounds.bottom {
            y_below
        } else if y_above >= bounds.top {
            y_above
        } else {
            bounds.bottom - popup_h
        };

        (x, y)
    } else {
        let (mouse_x, mouse_y) = commands::cursor::get_cursor_pos(app);
        let bounds = commands::cursor::get_screen_bounds(app, mouse_x, mouse_y);
        let popup_w = (POPUP_WIDTH * bounds.scale_factor) as i32;
        let popup_h = (POPUP_HEIGHT * bounds.scale_factor) as i32;

        let mut x = mouse_x - popup_w / 2;
        let mut y = mouse_y - popup_h - 10;

        if y < bounds.top {
            y = mouse_y + 20;
        }

        x = x.max(bounds.left).min(bounds.right - popup_w);
        y = y.max(bounds.top).min(bounds.bottom - popup_h);

        (x, y)
    };

    let popup = if let Some(popup) = app.get_webview_window("popup") {
        #[cfg(target_os = "windows")]
        let _ = popup.set_skip_taskbar(true);
        let _ = popup.set_always_on_top(true);

        let _ = popup
            .set_position(tauri::PhysicalPosition::new(target_x, target_y))
            .inspect_err(|e| log::warn!("Failed to position popup: {e}"));
        popup
    } else {
        WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("popup".into()))
            .title("")
            .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
            .min_inner_size(320.0, 250.0)
            .position(target_x as f64, target_y as f64)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .transparent(true)
            .shadow(false)
            .focused(false)
            .visible(false)
            .build()?
    };

    let ah = app.clone();
    let show_popup = popup.clone();
    popup.run_on_main_thread(move || {
        let state = ah.state::<SelectionState>();
        let Ok(snapshot) = state.snapshot.lock() else {
            return;
        };
        if !snapshot.is_current(id) {
            return;
        }
        // focused(false) keeps showing non-activating while Tauri tracks visibility for hide/focus.
        let _ = show_popup
            .show()
            .inspect_err(|e| log::warn!("Failed to show popup: {e}"));
        let _ = show_popup.emit("popup-refresh", ());
    })?;

    Ok(())
}
