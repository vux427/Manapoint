//! Start-at-login (Windows only): one value under HKCU\...\Run pointing at this exe.
//! HKCU is per-user so it needs no elevation, and the registry *is* the storage —
//! there is no separate settings field to keep in sync.

pub const VALUE_NAME: &str = "Manapoint";

#[cfg(windows)]
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";

pub fn is_supported() -> bool {
    cfg!(windows)
}

/// Paths with spaces need quoting or the shell truncates the command at the first space.
pub fn quote(path: &str) -> String {
    format!("\"{}\"", path.trim_matches('"'))
}

pub fn unquote(entry: &str) -> &str {
    entry.trim().trim_matches('"')
}

/// Registered *and* still pointing at a file that exists. A leftover entry from a moved
/// or deleted build would otherwise report as enabled while doing nothing.
#[cfg(windows)]
pub fn is_enabled() -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ)
    else {
        return false;
    };
    key.get_value::<String, _>(VALUE_NAME)
        .map(|entry| std::path::Path::new(unquote(&entry)).exists())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn is_enabled() -> bool {
    false
}

#[cfg(windows)]
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .map_err(|e| format!("打不開啟動登錄：{e}"))?;

    if enabled {
        let exe = std::env::current_exe()
            .map_err(|_| "找不到目前執行檔路徑，無法註冊開機啟動。".to_string())?;
        key.set_value(VALUE_NAME, &quote(&exe.to_string_lossy()))
            .map_err(|e| format!("寫入啟動登錄失敗：{e}"))
    } else {
        match key.delete_value(VALUE_NAME) {
            Ok(()) => Ok(()),
            // Absent means already disabled, which is the requested state.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("移除啟動登錄失敗：{e}")),
        }
    }
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> Result<(), String> {
    Err("開機啟動只支援 Windows。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_paths_with_spaces() {
        assert_eq!(
            r#""C:\Program Files\Manapoint.exe""#,
            quote(r"C:\Program Files\Manapoint.exe")
        );
    }

    /// An already-quoted value must not end up double-wrapped.
    #[test]
    fn quoting_is_idempotent() {
        let once = quote(r"C:\app.exe");
        assert_eq!(once, quote(&once));
    }

    #[test]
    fn unquotes_registry_entries() {
        assert_eq!(r"C:\app.exe", unquote(r#"  "C:\app.exe"  "#));
        assert_eq!(r"C:\app.exe", unquote(r"C:\app.exe"));
    }
}
