//! Reads the focused app's selected text through the macOS Accessibility API.
//!
//! Unlike the copy-keystroke fallback in `clipboard::capture_selection`, this
//! never touches the clipboard or sends keys, and an app that has no selection
//! answers immediately. That makes it cheap enough to check on every
//! post-processing recording (the post-processing hotkey turns into command
//! mode when text is selected).

/// What the focused app reported about its selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    /// Non-blank selected text.
    Text(String),
    /// The app reported its selection and nothing (or only whitespace) is selected.
    Empty,
    /// The app (or platform) doesn't expose its selection.
    Unknown,
}

impl Selection {
    fn from_reported(text: String) -> Self {
        if text.trim().is_empty() {
            Selection::Empty
        } else {
            Selection::Text(text)
        }
    }
}

#[cfg(target_os = "macos")]
pub fn focused_selection() -> Selection {
    match macos::selected_text() {
        Some(text) => Selection::from_reported(text),
        None => Selection::Unknown,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn focused_selection() -> Selection {
    Selection::Unknown
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CString};

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type AXUIElementRef = *const c_void;
    type CFIndex = isize;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_AX_ERROR_SUCCESS: i32 = 0;
    /// Seconds an unresponsive app may block the query.
    const MESSAGING_TIMEOUT_SECS: f32 = 0.25;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout: f32) -> i32;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        fn CFRelease(value: CFTypeRef);
        fn CFGetTypeID(value: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetLength(string: CFStringRef) -> CFIndex;
        fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
        fn CFStringGetCString(
            string: CFStringRef,
            buffer: *mut c_char,
            buffer_size: CFIndex,
            encoding: u32,
        ) -> u8;
    }

    /// Owned Core Foundation reference, released on drop.
    struct Owned(CFTypeRef);

    impl Drop for Owned {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) };
            }
        }
    }

    fn cf_string(value: &str) -> Option<Owned> {
        let c_value = CString::new(value).ok()?;
        let string = unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                c_value.as_ptr(),
                K_CF_STRING_ENCODING_UTF8,
            )
        };
        (!string.is_null()).then_some(Owned(string))
    }

    fn copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<Owned> {
        let name = cf_string(attribute)?;
        let mut value: CFTypeRef = std::ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut value) };
        if status != K_AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        Some(Owned(value))
    }

    fn to_string(value: &Owned) -> Option<String> {
        unsafe {
            if CFGetTypeID(value.0) != CFStringGetTypeID() {
                return None;
            }
            let length = CFStringGetLength(value.0);
            let capacity = CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8) + 1;
            let mut buffer = vec![0 as c_char; usize::try_from(capacity).ok()?];
            if CFStringGetCString(
                value.0,
                buffer.as_mut_ptr(),
                capacity,
                K_CF_STRING_ENCODING_UTF8,
            ) == 0
            {
                return None;
            }
            let bytes: Vec<u8> = buffer
                .iter()
                .take_while(|&&c| c != 0)
                .map(|&c| c as u8)
                .collect();
            String::from_utf8(bytes).ok()
        }
    }

    fn query_selected_text() -> Option<String> {
        let system = Owned(unsafe { AXUIElementCreateSystemWide() });
        if system.0.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(system.0, MESSAGING_TIMEOUT_SECS) };
        let focused = copy_attribute(system.0, "AXFocusedUIElement")?;
        let selected = copy_attribute(focused.0, "AXSelectedText")?;
        to_string(&selected)
    }

    /// Electron apps (Slack, VS Code, Notion, ...) build their accessibility
    /// tree only once a client sets `AXManualAccessibility`, the documented
    /// switch for assistive tools. Returns whether the app accepted it.
    fn enable_manual_accessibility_for_frontmost_app() -> bool {
        use objc2_app_kit::NSWorkspace;

        let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() else {
            return false;
        };
        let pid = app.processIdentifier();
        let element = Owned(unsafe { AXUIElementCreateApplication(pid) });
        let Some(name) = cf_string("AXManualAccessibility") else {
            return false;
        };
        if element.0.is_null() {
            return false;
        }
        unsafe {
            AXUIElementSetMessagingTimeout(element.0, MESSAGING_TIMEOUT_SECS);
            AXUIElementSetAttributeValue(element.0, name.0, kCFBooleanTrue) == K_AX_ERROR_SUCCESS
        }
    }

    /// The focused element's `AXSelectedText`, or `None` when the app doesn't
    /// expose it (no focused element, attribute unsupported, or not a string).
    pub(super) fn selected_text() -> Option<String> {
        if let Some(text) = query_selected_text() {
            return Some(text);
        }
        if enable_manual_accessibility_for_frontmost_app() {
            // The app builds its tree asynchronously after the switch flips.
            std::thread::sleep(std::time::Duration::from_millis(80));
            return query_selected_text();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::Selection;

    #[test]
    fn blank_reported_selection_is_empty() {
        assert_eq!(Selection::from_reported(String::new()), Selection::Empty);
        assert_eq!(Selection::from_reported(" \n\t".into()), Selection::Empty);
        assert_eq!(
            Selection::from_reported("hello".into()),
            Selection::Text("hello".into())
        );
    }
}
