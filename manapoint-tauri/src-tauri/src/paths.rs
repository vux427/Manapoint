use std::path::PathBuf;

pub fn home() -> PathBuf {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(key).map(PathBuf::from).unwrap_or_default()
}

/// Settings and cache directory (%APPDATA%\Manapoint on Windows).
pub fn app_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"));
    base.join("Manapoint")
}

/// The opencode CLI's credential file. Both the opencode Go key and the xAI OAuth
/// tokens live here, so the two collectors share this path derivation.
pub fn opencode_auth() -> PathBuf {
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| home().join(".local").join("share"));
    data_home.join("opencode").join("auth.json")
}

pub fn claude_credentials() -> PathBuf {
    home().join(".claude").join(".credentials.json")
}

pub fn codex_auth() -> PathBuf {
    home().join(".codex").join("auth.json")
}
