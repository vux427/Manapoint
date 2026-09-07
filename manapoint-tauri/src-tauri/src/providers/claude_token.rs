//! Reading and refreshing the Claude Code login (`claudeAiOauth` in .credentials.json).
//!
//! The refresh follows Claude Code's own OAuth flow: POST
//! https://platform.claude.com/v1/oauth/token with form fields grant_type /
//! refresh_token / client_id, where client_id is Claude Code's public value.
//! The reply carries access_token (required), refresh_token (rotated when present)
//! and expires_in seconds.
//!
//! Only this machine's own .credentials.json is touched, and only the
//! `claudeAiOauth` node — sibling metadata such as scopes or subscriptionType is
//! preserved. A local `expiresAt` is treated as a hint, never a verdict: an
//! expired-looking token still gets one usage attempt, because the CLI itself may
//! have refreshed concurrently. If a refresh loses a race, the file is re-read
//! and the winner's tokens are used.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;
use std::path::Path;

use crate::error::{CollectError, CollectResult};
use crate::paths;

/// Claude Code's public OAuth client. Embedded in open-source tooling; not a secret.
pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

pub const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";

/// Refresh this far ahead of expiry so a token cannot lapse mid-request. Polling runs
/// on the same five-minute cadence.
pub const REFRESH_SKEW_SECONDS: i64 = 300;

/// The stored login. A missing `expiresAt` counts as unknown and always refreshes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeEntry {
    pub access: String,
    pub refresh: String,
    pub expires_ms: i64,
}

/// Read the file and hand back a usable access token, refreshing and persisting first
/// if the stored one is spent. A failed proactive refresh falls back to the stored
/// token and lets the usage endpoint be the arbiter, so a stale clock or a hiccup
/// never shows a false "expired" card.
pub async fn access_token(http: &reqwest::Client) -> CollectResult<String> {
    let path = paths::claude_credentials();
    if !path.exists() {
        return Err(CollectError::not_ready(
            "找不到 Claude Code，請先安裝並執行 /login",
        ));
    }

    let entry = read_entry(&path)
        .ok_or_else(|| CollectError::not_ready("尚未登入，請在 Claude Code 執行 /login"))?;

    if !needs_refresh(&entry, Utc::now()) {
        return Ok(entry.access);
    }

    if entry.refresh.trim().is_empty() {
        return Ok(entry.access);
    }

    match refresh_once(http, &entry).await {
        Ok(refreshed) => {
            persist(&path, &refreshed);
            Ok(refreshed.access)
        }
        Err(_) => {
            // The refresh may have lost a race with Claude Code itself. Re-read: if the
            // winner's token looks usable, take it instead of failing.
            if let Some(latest) = read_entry(&path) {
                if latest.access != entry.access && !needs_refresh(&latest, Utc::now()) {
                    return Ok(latest.access);
                }
            }
            Ok(entry.access)
        }
    }
}

/// Force a refresh after the usage endpoint answered 401/403 with `failed_access`.
/// Returns a different, usable token when one can be had; otherwise explains that
/// the login itself needs attention.
pub async fn refresh_for_retry(
    http: &reqwest::Client,
    failed_access: &str,
) -> CollectResult<String> {
    let path = paths::claude_credentials();
    let entry = read_entry(&path)
        .ok_or_else(|| CollectError::not_ready("尚未登入，請在 Claude Code 執行 /login"))?;

    // Another process (Claude Code itself or a previous poll) may already have
    // rotated the file after we read it for the failed request.
    if entry.access != failed_access && !needs_refresh(&entry, Utc::now()) {
        return Ok(entry.access);
    }

    if entry.refresh.trim().is_empty() {
        return Err(CollectError::not_ready(
            "登入已失效，請在 Claude Code 執行 /login",
        ));
    }

    match refresh_once(http, &entry).await {
        Ok(refreshed) => {
            persist(&path, &refreshed);
            Ok(refreshed.access)
        }
        Err(e) if e.keeps_last_good() => {
            // Transient (network/5xx): say so and keep showing last numbers.
            Err(e)
        }
        Err(_) => {
            if let Some(latest) = read_entry(&path) {
                if latest.access != entry.access && !needs_refresh(&latest, Utc::now()) {
                    return Ok(latest.access);
                }
            }
            Err(CollectError::not_ready(
                "登入已失效，請在 Claude Code 執行 /login",
            ))
        }
    }
}

/// Expired, or close enough to it, means refresh. A missing expiry always refreshes.
pub fn needs_refresh(entry: &ClaudeEntry, now: DateTime<Utc>) -> bool {
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

/// One refresh round trip against the token endpoint.
async fn refresh_once(
    http: &reqwest::Client,
    old: &ClaudeEntry,
) -> CollectResult<ClaudeEntry> {
    let response = http
        .post(TOKEN_URL)
        .header("User-Agent", "claude-code/2.0.32")
        .form(&refresh_form(&old.refresh))
        .send()
        .await
        .map_err(|e| CollectError::transient(format!("Claude 換發連線失敗，稍後自動重試（{e}）")))?;

    if matches!(response.status().as_u16(), 400 | 401) {
        return Err(CollectError::not_ready(
            "登入已失效，請在 Claude Code 執行 /login",
        ));
    }

    let body = response
        .error_for_status()
        .map_err(|_| CollectError::transient("Claude 換發失敗，稍後自動重試"))?
        .text()
        .await
        .map_err(|_| CollectError::transient("Claude 換發失敗，稍後自動重試"))?;

    apply_refresh(old, &body, Utc::now())
}

/// Fold the refresh response into the stored entry. access_token is required. A missing
/// refresh_token keeps the old one: under rotation it is already spent, but keeping it
/// means the next 4xx takes the re-read path instead of failing outright. A missing
/// expires_in keeps the old expiry rather than inventing one.
pub fn apply_refresh(
    old: &ClaudeEntry,
    response_json: &str,
    now: DateTime<Utc>,
) -> CollectResult<ClaudeEntry> {
    let root: Value = serde_json::from_str(response_json)
        .map_err(|e| CollectError::transient(format!("Claude 換發回應異常，稍後自動重試（{e}）")))?;

    let access = root.get("access_token").and_then(Value::as_str).unwrap_or("");
    if access.trim().is_empty() {
        return Err(CollectError::transient(
            "Claude 換發回應缺少 access_token，稍後自動重試",
        ));
    }

    let refresh = root
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&old.refresh);

    let expires_ms = root
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|s| *s > 0)
        .map(|s| (now + chrono::Duration::seconds(s)).timestamp_millis())
        .unwrap_or(old.expires_ms);

    Ok(ClaudeEntry {
        access: access.to_string(),
        refresh: refresh.to_string(),
        expires_ms,
    })
}

/// Merge the refreshed tokens back into the file, touching only the token fields of
/// the `claudeAiOauth` node so sibling metadata (scopes, subscriptionType, ...) and
/// any other top-level sections survive untouched. Accepts both camelCase (what
/// Claude Code writes) and snake_case keys when reading.
pub fn merge_entry(original_file_json: &str, updated: &ClaudeEntry) -> CollectResult<String> {
    let mut root: Value = serde_json::from_str(original_file_json)?;
    let Some(map) = root.as_object_mut() else {
        return Err(CollectError::failed("Claude 憑證檔的最外層不是物件。"));
    };

    let mut node = map
        .get("claudeAiOauth")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(obj) = node.as_object_mut() else {
        return Err(CollectError::failed("Claude 憑證檔讀不懂，請重新執行 /login"));
    };

    obj.insert(
        "accessToken".to_string(),
        Value::String(updated.access.clone()),
    );
    obj.insert(
        "refreshToken".to_string(),
        Value::String(updated.refresh.clone()),
    );
    obj.insert(
        "expiresAt".to_string(),
        Value::Number(updated.expires_ms.into()),
    );
    // Drop snake_case aliases if a third-party tool left them behind, so the file
    // keeps a single canonical shape.
    for alias in ["access_token", "refresh_token", "expires_at"] {
        obj.remove(alias);
    }

    map.insert("claudeAiOauth".to_string(), node);

    Ok(serde_json::to_string_pretty(&root)?)
}

fn read_entry(path: &Path) -> Option<ClaudeEntry> {
    let text = std::fs::read_to_string(path).ok()?;
    let root: Value = serde_json::from_str(&text).ok()?;
    parse_entry(&root)
}

fn parse_entry(root: &Value) -> Option<ClaudeEntry> {
    let oauth = root.get("claudeAiOauth").filter(|v| v.is_object())?;

    let access = oauth
        .get("accessToken")
        .or_else(|| oauth.get("access_token"))
        .and_then(Value::as_str)?;
    if access.trim().is_empty() {
        return None;
    }

    let refresh = oauth
        .get("refreshToken")
        .or_else(|| oauth.get("refresh_token"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let expires_ms = oauth
        .get("expiresAt")
        .or_else(|| oauth.get("expires_at"))
        .and_then(Value::as_i64)
        .unwrap_or(0);

    Some(ClaudeEntry {
        access: access.to_string(),
        refresh,
        expires_ms,
    })
}

/// Atomic write: a temp file beside the target, then a rename over it, so a crash
/// mid-write cannot corrupt someone's credential file. A failed write is not fatal —
/// the fresh token is already in memory for this round.
fn persist(path: &Path, updated: &ClaudeEntry) {
    // Re-read first: Claude Code may have written its own refresh while we were doing ours.
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

    fn entry(expires_ms: i64) -> ClaudeEntry {
        entry_with(expires_ms, "a", "r")
    }

    fn entry_with(expires_ms: i64, access: &str, refresh: &str) -> ClaudeEntry {
        ClaudeEntry {
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

    /// No new refresh token means keep the old one; a missing expires_in keeps the
    /// old expiry rather than inventing one.
    #[test]
    fn apply_refresh_keeps_old_refresh_and_expiry_when_absent() {
        let updated =
            apply_refresh(&entry_with(ms(30), "a", "old-r"), r#"{"access_token":"new"}"#, now())
                .unwrap();

        assert_eq!("old-r", updated.refresh);
        assert_eq!(ms(30), updated.expires_ms);
    }

    #[test]
    fn apply_refresh_rejects_missing_access_token() {
        let err = apply_refresh(&entry(0), r#"{"refresh_token":"x"}"#, now()).unwrap_err();

        assert!(err.message().contains("access_token"), "{}", err.message());
        // A failed refresh is temporary, so the card keeps its numbers.
        assert!(err.keeps_last_good());
    }

    #[test]
    fn merge_entry_preserves_sibling_metadata() {
        let original = r#"{
            "claudeAiOauth": {
                "accessToken": "old", "refreshToken": "old-r", "expiresAt": 1,
                "scopes": ["user:inference"], "subscriptionType": "max"
            }
        }"#;

        let merged = merge_entry(original, &entry_with(2, "new", "new-r")).unwrap();
        let root: Value = serde_json::from_str(&merged).unwrap();
        let node = &root["claudeAiOauth"];

        assert_eq!("new", node["accessToken"].as_str().unwrap());
        assert_eq!("new-r", node["refreshToken"].as_str().unwrap());
        assert_eq!(2, node["expiresAt"].as_i64().unwrap());
        assert_eq!("max", node["subscriptionType"].as_str().unwrap());
        assert!(node["scopes"].is_array());
    }

    #[test]
    fn parse_entry_accepts_snake_case_keys() {
        let root: Value =
            serde_json::from_str(r#"{"claudeAiOauth":{"access_token":"a","refresh_token":"r","expires_at":5}}"#)
                .unwrap();
        let parsed = parse_entry(&root).unwrap();

        assert_eq!("a", parsed.access);
        assert_eq!("r", parsed.refresh);
        assert_eq!(5, parsed.expires_ms);
    }

    #[test]
    fn parse_entry_rejects_blank_access() {
        let root: Value =
            serde_json::from_str(r#"{"claudeAiOauth":{"accessToken":"  "}}"#).unwrap();
        assert!(parse_entry(&root).is_none());
    }
}
