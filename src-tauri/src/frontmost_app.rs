//! Frontmost application detection, used to pick a per-app post-processing
//! prompt. Detection runs when a recording starts; the last result is kept so
//! the settings UI can offer it when creating an app rule.
//!
//! macOS reports the bundle identifier (e.g. `com.tinyspeck.slackmacgap`),
//! Windows the executable name (e.g. `slack.exe`). Other platforms report no
//! app, which makes post-processing fall back to the selected prompt.

use serde::Serialize;
use specta::Type;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct FrontmostApp {
    /// Identifier app rules match against: bundle ID on macOS, process name elsewhere.
    pub id: String,
    /// Human-readable name for the settings UI.
    pub name: String,
}

static LAST_DETECTED: Mutex<Option<FrontmostApp>> = Mutex::new(None);

/// Detects the frontmost app and remembers it as the last detected app.
/// Returns `None` (and clears the remembered app) when nothing was detected.
pub fn detect_and_remember() -> Option<FrontmostApp> {
    let app = detect();
    match &app {
        Some(app) => log::debug!("Frontmost app at recording start: {}", app.id),
        None => log::debug!("No frontmost app detected at recording start"),
    }
    if let Ok(mut last) = LAST_DETECTED.lock() {
        last.clone_from(&app);
    }
    app
}

/// The app detected at the start of the most recent recording.
pub fn last_detected() -> Option<FrontmostApp> {
    LAST_DETECTED.lock().ok().and_then(|last| last.clone())
}

#[cfg(target_os = "macos")]
fn detect() -> Option<FrontmostApp> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let id = app.bundleIdentifier()?.to_string();
    let name = app
        .localizedName()
        .map(|name| name.to_string())
        .unwrap_or_else(|| id.clone());
    Some(FrontmostApp { id, name })
}

#[cfg(target_os = "windows")]
fn detect() -> Option<FrontmostApp> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        result.ok()?;

        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        let file_name = std::path::Path::new(&path).file_name()?.to_str()?;
        let name = file_name
            .strip_suffix(".exe")
            .or_else(|| file_name.strip_suffix(".EXE"))
            .unwrap_or(file_name)
            .to_string();
        Some(FrontmostApp {
            id: file_name.to_string(),
            name,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn detect() -> Option<FrontmostApp> {
    None
}
