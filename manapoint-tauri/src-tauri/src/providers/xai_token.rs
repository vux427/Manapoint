//! Reading and refreshing the xAI login opencode stores (the "xai" node of auth.json).
//!
//! The refresh follows opencode's own plugin/xai.ts: POST https://auth.x.ai/oauth2/token
//! with the public Grok-CLI client_id and form fields grant_type / refresh_token /
//! client_id. The reply carries access_token (required), refresh_token (rotated, but not
//! sent every time) and expires_in seconds (3600 when absent).
//!
//! Only this machine's own auth.json is touched. If a concurrent refresh consumes the old
//! refresh token first, the file is re-read and the winner's tokens are used; the user is
//! only asked to sign in again when the file cannot rescue it either.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;
use std::path::Path;

use crate::error::{CollectError, CollectResult};
use crate::paths;

/// The public Grok-CLI OAuth client. Embedded in opencode's open source; not a secret.
pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";

pub const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";

/// Refresh this far ahead of expiry so a token cannot lapse mid-request. Polling runs
/// on the same five-minute cadence.
pub const REFRESH_SKEW_SECONDS: i64 = 300;

const DEFAULT_EXPIRES_IN_SECONDS: i64 = 3600;

/// The stored login. A missing `expires` counts as unknown and always refreshes, which
/// is what opencode itself does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XaiEntry {
    pub entry_type: String,
    pub access: String,
    pub refresh: String,
    pub expires_ms: i64,
}

/// Read the file and hand back a usable access token, refreshing and persisting first
/// if the stored one is spent.
pub async fn access_token(http: &reqwest::Client) -> CollectResult<String> {
    let path = paths::opencode_auth();
    if !path.exists() {
        return Err(CollectError::not_ready("找不到 opencode，請先安裝並登入 xAI"));
    }

    let entry = read_entry(&path)
        .ok_or_else(|| CollectError::not_ready("尚未登入 xAI，請在 opencode 登入"))?;

    if !needs_refresh(&entry, Utc::now()) {
        return Ok(entry.access);
    }

    if entry.refresh.trim().is_empty() {
        return Err(CollectError::not_ready("xAI 登入已過期，請在 opencode 重新登入"));
    }

    let response = http
        .post(TOKEN_URL)
        .form(&refresh_form(&entry.refresh))
        .send()
        .await
        .map_err(|e| CollectError::transient(format!("xAI 換發連線失敗，稍後自動重試（{e}）")))?;

    if matches!(response.status().as_u16(), 400 | 401) {
        // The refresh token was consumed or revoked — most likely opencode refreshed
        // first. Re-read the file: if the winner's token works, use it rather than
        // sending the user back to a login prompt.
        if let Some(latest) = read_entry(&path) {
            if latest.access != entry.access && !needs_refresh(&latest, Utc::now()) {
                return Ok(latest.access);
            }
        }
        return Err(CollectError::not_ready("xAI 登入已失效，請在 opencode 重新登入"));
    }

    let body = response
        .error_for_status()
        .map_err(|_| CollectError::transient("xAI 換發失敗，稍後自動重試"))?
        .text()
        .await
        .map_err(|_| CollectError::transient("xAI 換發失敗，稍後自動重試"))?;

    let refreshed = apply_refresh(&entry, &body, Utc::now())?;
    persist(&path, &refreshed);
    Ok(refreshed.access)
}

/// Expired, or close enough to it, means refresh. A missing expiry always refreshes.
pub fn needs_refresh(entry: &XaiEntry, now: DateTime<Utc>) -> bool {
    if entry.access.trim().is_empty() || entry.expires_ms <= 0 {
        return true;
    }
    match Utc.timestamp_millis_opt(entry.expires_ms).single() {
        Some(expiry) => expiry <= now + chrono::Duration::seconds(REFRESH_SKEW_SECONDS),
        None => true,
    }
}

/// Form fields for the standard OAuth refresh.
pub fn refresh_form(refresh_token: &str) -> [(&'static str, String); 3] {
    [
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("client_id", CLIENT_ID.to_string()),
    ]
}

/// Fold the refresh response into the stored entry. access_token is required. A missing
/// refresh_token keeps the old one: under rotation it is already spent, but keeping it
/// means the next 4xx takes the re-read path instead of failing outright. A missing
/// expires_in counts as 3600 seconds, matching opencode.
pub fn apply_refresh(
    old: &XaiEntry,
    response_json: &str,
    now: DateTime<Utc>,
) -> CollectResult<XaiEntry> {
    let root: Value = serde_json::from_str(response_json)
        .map_err(|e| CollectError::transient(format!("xAI 換發回應異常，稍後自動重試（{e}）")))?;

    let access = root.get("access_token").and_then(Value::as_str).unwrap_or("");
    if access.trim().is_empty() {
        return Err(CollectError::transient("xAI 換發回應缺少 access_token，稍後自動重試"));
    }

    let refresh = root
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&old.refresh);

    let expires_in = root
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_EXPIRES_IN_SECONDS)
        .max(0);

    Ok(XaiEntry {
        entry_type: old.entry_type.clone(),
        access: access.to_string(),
        refresh: refresh.to_string(),
        expires_ms: (now + chrono::Duration::seconds(expires_in)).timestamp_millis(),
    })
}

/// Merge the entry back into the file, touching only the "xai" node so other
/// providers' credentials survive untouched.
pub fn merge_entry(original_file_json: &str, updated: &XaiEntry) -> CollectResult<String> {
    let mut root: Value = serde_json::from_str(original_file_json)?;
    let Some(map) = root.as_object_mut() else {
        return Err(CollectError::failed("opencode auth.json 的最外層不是物件。"));
    };

    map.insert(
        "xai".to_string(),
        serde_json::json!({
            "type": updated.entry_type,
            "access": updated.access,
            "refresh": updated.refresh,
            "expires": updated.expires_ms,
        }),
    );

    Ok(serde_json::to_string_pretty(&root)?)
}

fn read_entry(path: &Path) -> Option<XaiEntry> {
    let text = std::fs::read_to_string(path).ok()?;
    let root: Value = serde_json::from_str(&text).ok()?;
    parse_entry(&root)
}

fn parse_entry(root: &Value) -> Option<XaiEntry> {
    let entry = root.get("xai").filter(|v| v.is_object())?;

    let access = entry.get("access").and_then(Value::as_str)?;
    if access.trim().is_empty() {
        return None;
    }

    Some(XaiEntry {
        entry_type: entry
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("oauth")
            .to_string(),
        access: access.to_string(),
        refresh: entry.get("refresh").and_then(Value::as_str).unwrap_or("").to_string(),
        expires_ms: entry.get("expires").and_then(Value::as_i64).unwrap_or(0),
    })
}

/// Atomic write: a temp file beside the target, then a rename over it, so a crash
/// mid-write cannot corrupt someone's credential file. A failed write is not fatal —
/// the fresh token is already in memory for this round.
fn persist(path: &Path, updated: &XaiEntry) {
    // Re-read first: opencode may have written its own refresh while we were doing ours.
    let Ok(latest) = std::fs::read_to_string(path) else { return };
    let Ok(merged) = merge_entry(&latest, updated) else { return };

    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, merged).is_ok() && std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.timestamp_millis_opt(1788624612000).unwrap()
    }

    fn entry(expires_ms: i64) -> XaiEntry {
        entry_with(expires_ms, "a", "r")
    }

    fn entry_with(expires_ms: i64, access: &str, refresh: &str) -> XaiEntry {
        XaiEntry {
            entry_type: "oauth".into(),
            access: access.into(),
            refresh: refresh.into(),
            expires_ms,
        }
    }

    fn ms(offset_minutes: i64) -> i64 {
        (now() + chrono::Duration::minutes(offset_minutes)).timestamp_millis()
    }

    #[test]
    fn fresh_token_needs_no_refresh() {
        assert!(!needs_refresh(&entry(ms(120)), now()));
    }

    #[test]
    fn expired_token_needs_refresh() {
        assert!(needs_refresh(&entry(ms(-60)), now()));
    }

    /// Inside the last five minutes it refreshes early rather than risk a mid-call expiry.
    #[test]
    fn refreshes_proactively_within_skew() {
        assert!(needs_refresh(&entry(ms(4)), now()));
        assert!(!needs_refresh(&entry(ms(6)), now()));
    }

    #[test]
    fn missing_expiry_always_refreshes() {
        assert!(needs_refresh(&entry(0), now()));
        assert!(needs_refresh(&entry(-1), now()));
    }

    #[test]
    fn empty_access_refreshes() {
        assert!(needs_refresh(&entry_with(ms(120), "", "r"), now()));
    }

    #[test]
    fn refresh_form_carries_grant_and_public_client() {
        let form = refresh_form("refresh-secret");

        assert_eq!(("grant_type", "refresh_token".to_string()), form[0]);
        assert_eq!(("refresh_token", "refresh-secret".to_string()), form[1]);
        assert_eq!(("client_id", CLIENT_ID.to_string()), form[2]);
    }

    #[test]
    fn apply_refresh_rotates_tokens() {
        let json = r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":7200}"#;
        let updated = apply_refresh(&entry(ms(0)), json, now()).unwrap();

        assert_eq!("new-access", updated.access);
        assert_eq!("new-refresh", updated.refresh);
        assert_eq!(ms(120), updated.expires_ms);
    }

    /// No new refresh token means keep the old one; a missing expires_in means 3600s.
    #[test]
    fn apply_refresh_keeps_old_refresh_and_defaults_expiry() {
        let updated =
            apply_refresh(&entry_with(ms(0), "a", "old-r"), r#"{"access_token":"new"}"#, now())
                .unwrap();

        assert_eq!("old-r", updated.refresh);
        assert_eq!(ms(60), updated.expires_ms);
    }

    #[test]
    fn apply_refresh_rejects_missing_access_token() {
        let err = apply_refresh(&entry(0), r#"{"refresh_token":"x"}"#, now()).unwrap_err();

        assert!(err.message().contains("access_token"), "{}", err.message());
        // A failed refresh is temporary, so the card keeps its numbers.
        assert!(err.keeps_last_good());
    }

    #[test]
    fn merge_entry_only_touches_xai() {
        let original = r#"{
            "opencode-go": { "key": "sk-keep" },
            "xai": { "type": "oauth", "access": "old", "refresh": "old-r", "expires": 1 }
        }"#;

        let merged = merge_entry(original, &entry_with(2, "new", "new-r")).unwrap();
        let root: Value = serde_json::from_str(&merged).unwrap();

        assert_eq!("sk-keep", root["opencode-go"]["key"].as_str().unwrap());
        assert_eq!("new", root["xai"]["access"].as_str().unwrap());
        assert_eq!("new-r", root["xai"]["refresh"].as_str().unwrap());
        assert_eq!(2, root["xai"]["expires"].as_i64().unwrap());
    }

    /// A file with no xai node (only other providers signed in) is not a login.
    #[test]
    fn parse_entry_requires_xai_section() {
        let root: Value = serde_json::from_str(r#"{"opencode-go":{"key":"k"}}"#).unwrap();
        assert!(parse_entry(&root).is_none());
    }

    #[test]
    fn parse_entry_rejects_blank_access() {
        let root: Value = serde_json::from_str(r#"{"xai":{"access":"  "}}"#).unwrap();
        assert!(parse_entry(&root).is_none());
    }
}
