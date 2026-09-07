//! Reading and refreshing the Codex CLI login (`tokens` in auth.json).
//!
//! The refresh follows Codex's own OAuth flow: POST https://auth.openai.com/oauth/token
//! with a JSON body of client_id / grant_type / refresh_token, where client_id is
//! Codex's public value. The reply carries access_token and the rotated refresh_token
//! (plus id_token when present). Both the endpoint and the client id honour Codex's
//! own override env vars so test rigs keep working.
//!
//! Only this machine's own auth.json is touched, and only the `tokens` node plus
//! `last_refresh` — siblings such as OPENAI_API_KEY survive untouched. The stored
//! access token is a JWT: its `exp` claim drives proactive refresh (five minutes
//! early, matching the polling cadence), with `last_refresh` older than eight days
//! as a fallback, mirroring the CLI. As with the other providers, a failed
//! proactive refresh falls back to the stored token and lets the usage endpoint be
//! the arbiter, so a hiccup never shows a false "expired" card. Rotation races are
//! handled by re-reading the file before giving up.

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::Value;
use std::path::Path;

use crate::error::{CollectError, CollectResult};
use crate::paths;

/// Codex's public OAuth client. Embedded in the open-source CLI; not a secret.
pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

/// Env var Codex itself honours to override the client id (e.g. test rigs).
pub const CLIENT_ID_OVERRIDE_ENV_VAR: &str = "CODEX_APP_SERVER_LOGIN_CLIENT_ID";

pub const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";

/// Env var Codex itself honours to point refresh at a mock server.
pub const TOKEN_URL_OVERRIDE_ENV_VAR: &str = "CODEX_REFRESH_TOKEN_URL_OVERRIDE";

/// Refresh this far ahead of JWT expiry so a token cannot lapse mid-request.
pub const REFRESH_SKEW_SECONDS: i64 = 300;

/// The CLI treats a session untouched for this long as stale even if the JWT parses.
const STALE_AFTER_DAYS: i64 = 8;

/// The stored login. `last_refresh` is absent on API-key/agent setups, which never
/// reach the refresh path anyway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexEntry {
    pub access: String,
    pub refresh: String,
    pub id_token: String,
    pub account_id: String,
    pub last_refresh: Option<DateTime<Utc>>,
}

pub fn oauth_client_id() -> String {
    std::env::var(CLIENT_ID_OVERRIDE_ENV_VAR)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| CLIENT_ID.to_string())
}

fn token_url() -> String {
    std::env::var(TOKEN_URL_OVERRIDE_ENV_VAR)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| TOKEN_URL.to_string())
}

/// Read the file and hand back usable credentials, refreshing and persisting first
/// when the stored access token is spent or stale.
pub async fn credentials(http: &reqwest::Client) -> CollectResult<(String, String)> {
    let path = paths::codex_auth();
    if !path.exists() {
        return Err(CollectError::not_ready(
            "找不到 Codex CLI，請先安裝並登入",
        ));
    }

    let entry = read_entry(&path)
        .ok_or_else(|| CollectError::not_ready("尚未登入，請執行 codex 登入"))?;

    if entry.access.trim().is_empty() || entry.account_id.trim().is_empty() {
        return Err(CollectError::not_ready(
            "登入資料不完整，請重新執行 codex 登入",
        ));
    }

    if !needs_refresh(&entry, Utc::now()) {
        return Ok((entry.access, entry.account_id));
    }

    if entry.refresh.trim().is_empty() {
        return Ok((entry.access, entry.account_id));
    }

    match refresh_once(http, &entry).await {
        Ok(refreshed) => {
            persist(&path, &refreshed);
            Ok((refreshed.access, refreshed.account_id))
        }
        Err(_) => {
            // The refresh may have lost a race with Codex itself. Re-read: if the
            // winner's token looks usable, take it instead of failing.
            if let Some(latest) = read_entry(&path) {
                if latest.access != entry.access && !needs_refresh(&latest, Utc::now()) {
                    return Ok((latest.access, latest.account_id));
                }
            }
            Ok((entry.access, entry.account_id))
        }
    }
}

/// Force a refresh after the usage endpoint answered 401/403 with `failed_access`.
/// Returns fresh credentials when they can be had; otherwise explains that the
/// login itself needs attention.
pub async fn refresh_for_retry(
    http: &reqwest::Client,
    failed_access: &str,
) -> CollectResult<(String, String)> {
    let path = paths::codex_auth();
    let entry = read_entry(&path)
        .ok_or_else(|| CollectError::not_ready("尚未登入，請執行 codex 登入"))?;

    // Codex itself may already have rotated the file after we read it.
    if entry.access != failed_access
        && !entry.access.trim().is_empty()
        && !needs_refresh(&entry, Utc::now())
    {
        return Ok((entry.access, entry.account_id));
    }

    if entry.refresh.trim().is_empty() {
        return Err(CollectError::not_ready(
            "登入已過期，請重新執行 codex 登入",
        ));
    }

    match refresh_once(http, &entry).await {
        Ok(refreshed) => {
            persist(&path, &refreshed);
            Ok((refreshed.access, refreshed.account_id))
        }
        Err(e) if e.keeps_last_good() => Err(e),
        Err(_) => {
            if let Some(latest) = read_entry(&path) {
                if latest.access != entry.access && !needs_refresh(&latest, Utc::now()) {
                    return Ok((latest.access, latest.account_id));
                }
            }
            Err(CollectError::not_ready(
                "登入已過期，請重新執行 codex 登入",
            ))
        }
    }
}

/// A spent JWT, or a session untouched for over a week, means refresh. When neither
/// signal is available the token is used as-is and the endpoint decides.
pub fn needs_refresh(entry: &CodexEntry, now: DateTime<Utc>) -> bool {
    if entry.access.trim().is_empty() {
        return true;
    }
    if let Some(exp) = jwt_exp_unix(&entry.access) {
        if let Some(expiry) = Utc.timestamp_opt(exp, 0).single() {
            return expiry <= now + chrono::Duration::seconds(REFRESH_SKEW_SECONDS);
        }
    }
    if let Some(last) = entry.last_refresh {
        return last < now - chrono::Duration::days(STALE_AFTER_DAYS);
    }
    false
}

/// `exp` (unix seconds) from a JWT's payload without verifying the signature — expiry
/// is a hint for proactive refresh, not a security decision.
pub fn jwt_exp_unix(token: &str) -> Option<i64> {
    let mut parts = token.split('.');
    let (_header, payload, _sig) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let bytes = decode_base64url(payload)?;
    let json: Value = serde_json::from_slice(&bytes).ok()?;
    json.get("exp")?.as_i64()
}

fn decode_base64url(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4 + 4);
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for c in input.chars() {
        let v = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '-' => 62,
            '_' => 63,
            '=' => break,
            _ => return None,
        };
        buffer = (buffer << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// One refresh round trip against the token endpoint.
async fn refresh_once(http: &reqwest::Client, old: &CodexEntry) -> CollectResult<CodexEntry> {
    let body = serde_json::json!({
        "client_id": oauth_client_id(),
        "grant_type": "refresh_token",
        "refresh_token": old.refresh,
    });

    let response = http
        .post(token_url())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| CollectError::transient(format!("Codex 換發連線失敗，稍後自動重試（{e}）")))?;

    if matches!(response.status().as_u16(), 400 | 401) {
        return Err(CollectError::not_ready(
            "登入已過期，請重新執行 codex 登入",
        ));
    }

    let text = response
        .error_for_status()
        .map_err(|_| CollectError::transient("Codex 換發失敗，稍後自動重試"))?
        .text()
        .await
        .map_err(|_| CollectError::transient("Codex 換發失敗，稍後自動重試"))?;

    apply_refresh(old, &text, Utc::now())
}

/// Fold the refresh response into the stored entry. Tokens absent from the reply keep
/// their old values (the CLI persists only what the response contains); the account
/// id is not part of the reply and always survives. `last_refresh` advances to now.
pub fn apply_refresh(
    old: &CodexEntry,
    response_json: &str,
    now: DateTime<Utc>,
) -> CollectResult<CodexEntry> {
    let root: Value = serde_json::from_str(response_json)
        .map_err(|e| CollectError::transient(format!("Codex 換發回應異常，稍後自動重試（{e}）")))?;

    let access = root
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&old.access);
    if access.trim().is_empty() {
        return Err(CollectError::transient(
            "Codex 換發回應缺少 access_token，稍後自動重試",
        ));
    }

    let refresh = root
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&old.refresh);

    let id_token = root
        .get("id_token")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&old.id_token);

    Ok(CodexEntry {
        access: access.to_string(),
        refresh: refresh.to_string(),
        id_token: id_token.to_string(),
        account_id: old.account_id.clone(),
        last_refresh: Some(now),
    })
}

/// Merge refreshed tokens back into the file, touching only `tokens` and
/// `last_refresh` so siblings (auth_mode, OPENAI_API_KEY, ...) survive untouched.
/// Token fields absent from the refresh keep their file values.
pub fn merge_entry(original_file_json: &str, updated: &CodexEntry) -> CollectResult<String> {
    let mut root: Value = serde_json::from_str(original_file_json)?;
    let Some(map) = root.as_object_mut() else {
        return Err(CollectError::failed("Codex 憑證檔的最外層不是物件。"));
    };

    let mut tokens = map
        .get("tokens")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(obj) = tokens.as_object_mut() else {
        return Err(CollectError::failed("Codex 憑證檔讀不懂，請重新執行 codex 登入"));
    };

    if !updated.access.trim().is_empty() {
        obj.insert(
            "access_token".to_string(),
            Value::String(updated.access.clone()),
        );
    }
    if !updated.refresh.trim().is_empty() {
        obj.insert(
            "refresh_token".to_string(),
            Value::String(updated.refresh.clone()),
        );
    }
    if !updated.id_token.trim().is_empty() {
        obj.insert("id_token".to_string(), Value::String(updated.id_token.clone()));
    }
    if !updated.account_id.trim().is_empty() {
        obj.insert(
            "account_id".to_string(),
            Value::String(updated.account_id.clone()),
        );
    }
    map.insert("tokens".to_string(), tokens);

    map.insert(
        "last_refresh".to_string(),
        Value::String(
            updated
                .last_refresh
                .unwrap_or_else(Utc::now)
                .to_rfc3339_opts(SecondsFormat::Millis, true),
        ),
    );

    Ok(serde_json::to_string_pretty(&root)?)
}

fn read_entry(path: &Path) -> Option<CodexEntry> {
    let text = std::fs::read_to_string(path).ok()?;
    let root: Value = serde_json::from_str(&text).ok()?;
    parse_entry(&root)
}

fn parse_entry(root: &Value) -> Option<CodexEntry> {
    let tokens = root.get("tokens").filter(|v| v.is_object())?;

    let access = tokens.get("access_token").and_then(Value::as_str)?;
    if access.trim().is_empty() {
        return None;
    }

    let last_refresh = root
        .get("last_refresh")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));

    Some(CodexEntry {
        access: access.to_string(),
        refresh: tokens
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        id_token: tokens
            .get("id_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        account_id: tokens
            .get("account_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        last_refresh,
    })
}

/// Atomic write: a temp file beside the target, then a rename over it, so a crash
/// mid-write cannot corrupt someone's credential file. A failed write is not fatal —
/// the fresh token is already in memory for this round.
fn persist(path: &Path, updated: &CodexEntry) {
    // Re-read first: Codex may have written its own refresh while we were doing ours.
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

    /// Minimal unsigned JWT with the given payload JSON.
    fn jwt(payload: &str) -> String {
        fn enc(bytes: &[u8]) -> String {
            const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            let mut s = String::new();
            let mut chunks = bytes.chunks_exact(3);
            for c in &mut chunks {
                let n = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | c[2] as u32;
                s.push(ALPHABET[(n >> 18) as usize & 63] as char);
                s.push(ALPHABET[(n >> 12) as usize & 63] as char);
                s.push(ALPHABET[(n >> 6) as usize & 63] as char);
                s.push(ALPHABET[n as usize & 63] as char);
            }
            let rem = chunks.remainder();
            if rem.len() == 1 {
                let n = (rem[0] as u32) << 16;
                s.push(ALPHABET[(n >> 18) as usize & 63] as char);
                s.push(ALPHABET[(n >> 12) as usize & 63] as char);
            } else if rem.len() == 2 {
                let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
                s.push(ALPHABET[(n >> 18) as usize & 63] as char);
                s.push(ALPHABET[(n >> 12) as usize & 63] as char);
                s.push(ALPHABET[(n >> 6) as usize & 63] as char);
            }
            s
        }
        format!("{}.{}.sig", enc(br#"{"alg":"none"}"#), enc(payload.as_bytes()))
    }

    fn entry(access: &str) -> CodexEntry {
        CodexEntry {
            access: access.into(),
            refresh: "r".into(),
            id_token: "id".into(),
            account_id: "acc".into(),
            last_refresh: Some(now()),
        }
    }

    #[test]
    fn parses_exp_from_jwt_payload() {
        let exp = now().timestamp() + 3600;
        assert_eq!(Some(exp), jwt_exp_unix(&jwt(&format!(r#"{{"exp":{exp}}}"#))));
    }

    #[test]
    fn rejects_malformed_tokens() {
        assert_eq!(None, jwt_exp_unix("not-a-jwt"));
        assert_eq!(None, jwt_exp_unix("a.b.c.d"));
        assert_eq!(None, jwt_exp_unix(&jwt(r#"{"no_exp":1}"#)));
    }

    #[test]
    fn fresh_jwt_needs_no_refresh() {
        let exp = (now() + chrono::Duration::hours(2)).timestamp();
        assert!(!needs_refresh(&entry(&jwt(&format!(r#"{{"exp":{exp}}}"#))), now()));
    }

    #[test]
    fn expiring_jwt_needs_refresh_within_skew() {
        let soon = (now() + chrono::Duration::minutes(4)).timestamp();
        let later = (now() + chrono::Duration::minutes(6)).timestamp();
        assert!(needs_refresh(&entry(&jwt(&format!(r#"{{"exp":{soon}}}"#))), now()));
        assert!(!needs_refresh(&entry(&jwt(&format!(r#"{{"exp":{later}}}"#))), now()));
    }

    #[test]
    fn stale_last_refresh_triggers_without_jwt_exp() {
        let mut e = entry("opaque-token-without-dots");
        e.last_refresh = Some(now() - chrono::Duration::days(9));
        assert!(needs_refresh(&e, now()));

        e.last_refresh = Some(now() - chrono::Duration::days(2));
        assert!(!needs_refresh(&e, now()));
    }

    #[test]
    fn empty_access_always_refreshes() {
        let mut e = entry("");
        e.last_refresh = None;
        assert!(needs_refresh(&e, now()));
    }

    #[test]
    fn apply_refresh_rotates_tokens_and_stamps_time() {
        let json = r#"{"access_token":"new-a","refresh_token":"new-r","id_token":"new-id"}"#;
        let updated = apply_refresh(&entry("old"), json, now()).unwrap();

        assert_eq!("new-a", updated.access);
        assert_eq!("new-r", updated.refresh);
        assert_eq!("new-id", updated.id_token);
        assert_eq!("acc", updated.account_id);
        assert_eq!(Some(now()), updated.last_refresh);
    }

    #[test]
    fn apply_refresh_keeps_missing_fields() {
        let updated = apply_refresh(&entry("old"), r#"{"access_token":"new-a"}"#, now()).unwrap();

        assert_eq!("new-a", updated.access);
        assert_eq!("r", updated.refresh);
        assert_eq!("id", updated.id_token);
    }

    #[test]
    fn apply_refresh_rejects_empty_access_without_old() {
        let mut e = entry("");
        e.access = "".into();
        let err = apply_refresh(&e, r#"{}"#, now()).unwrap_err();

        assert!(err.message().contains("access_token"), "{}", err.message());
        assert!(err.keeps_last_good());
    }

    #[test]
    fn merge_entry_only_touches_tokens_and_last_refresh() {
        let original = r#"{
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": "keep-me",
            "tokens": { "id_token": "old-id", "access_token": "old", "refresh_token": "old-r", "account_id": "acc" },
            "last_refresh": "2026-01-01T00:00:00.000Z"
        }"#;

        let updated = CodexEntry {
            access: "new".into(),
            refresh: "new-r".into(),
            id_token: "new-id".into(),
            account_id: "acc".into(),
            last_refresh: Some(now()),
        };
        let merged = merge_entry(original, &updated).unwrap();
        let root: Value = serde_json::from_str(&merged).unwrap();

        assert_eq!("chatgpt", root["auth_mode"].as_str().unwrap());
        assert_eq!("keep-me", root["OPENAI_API_KEY"].as_str().unwrap());
        assert_eq!("new", root["tokens"]["access_token"].as_str().unwrap());
        assert_eq!("new-r", root["tokens"]["refresh_token"].as_str().unwrap());
        assert_eq!("new-id", root["tokens"]["id_token"].as_str().unwrap());
        assert_eq!("acc", root["tokens"]["account_id"].as_str().unwrap());
        let stamped = root["last_refresh"].as_str().unwrap();
        let parsed = DateTime::parse_from_rfc3339(stamped)
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(now(), parsed);
    }
}
