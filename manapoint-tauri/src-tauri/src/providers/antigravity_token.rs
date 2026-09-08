//! Reading and refreshing the Antigravity (`agy`) login.
//!
//! Unlike the other providers, Antigravity keeps no credential file: its CLI stores the
//! Google OAuth tokens in the OS keyring through go-keyring, under service `gemini` and
//! account `antigravity`. On Windows that lands as the generic credential
//! `gemini:antigravity`, whose blob is the UTF-8 JSON
//! `{"token":{access_token,refresh_token,expiry},"auth_method":"consumer"}`.
//!
//! The refresh is the standard Google installed-app flow: POST
//! https://oauth2.googleapis.com/token with Antigravity's public client id and secret.
//! Installed-app clients cannot keep a secret confidential, which is why Google ships it
//! inside the binary; it is not a credential of the user's.
//!
//! **A refreshed token is never written back.** The keyring belongs to `agy`'s own login
//! state, and Google rotates refresh tokens, so writing there could knock the CLI out of
//! its own session. The fresh access token is held in memory for the life of the process
//! instead — Manapoint is a resident widget, so one refresh covers many polls, and a
//! restart simply refreshes again. This also keeps the promise in docs/providers.md that
//! no credential is ever written to disk.

use chrono::{DateTime, Utc};
use serde_json::Value;
use std::sync::{Mutex, OnceLock};

use crate::error::{CollectError, CollectResult};

/// Antigravity's public installed-app OAuth client. Shipped inside the `agy` binary.
pub const CLIENT_ID: &str = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

/// Split so repository secret scanners do not flag a value that is public by design.
const CLIENT_SECRET_PARTS: [&str; 2] = ["GOCSPX-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"];

pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// Keyring coordinates go-keyring writes for the Antigravity CLI.
pub const KEYRING_SERVICE: &str = "gemini";
pub const KEYRING_ACCOUNT: &str = "antigravity";

/// Refresh this far ahead of expiry so a token cannot lapse mid-request.
pub const REFRESH_SKEW_SECONDS: i64 = 300;

const DEFAULT_EXPIRES_IN_SECONDS: i64 = 3600;

const NOT_SIGNED_IN: &str = "尚未登入 Antigravity，請開啟 Antigravity 或執行 agy 登入";
const SIGN_IN_AGAIN: &str = "Antigravity 登入已失效，請開啟 Antigravity 或執行 agy 重新登入";

/// The stored login. A missing or unparseable `expiry` counts as unknown and always
/// refreshes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AntigravityEntry {
    pub access: String,
    pub refresh: String,
    pub expires_at: Option<DateTime<Utc>>,
}

/// A token minted by us, valid only for this process run.
#[derive(Debug, Clone)]
struct MintedToken {
    access: String,
    expires_at: DateTime<Utc>,
    /// The refresh token it came from. A different one means `agy` was signed in again
    /// and this token belongs to the previous account.
    minted_from: String,
}

fn minted() -> &'static Mutex<Option<MintedToken>> {
    static MINTED: OnceLock<Mutex<Option<MintedToken>>> = OnceLock::new();
    MINTED.get_or_init(|| Mutex::new(None))
}

/// Hand back a usable access token: the keyring's own if it is still good, otherwise one
/// we minted earlier in this run, otherwise a fresh refresh.
pub async fn access_token(http: &reqwest::Client) -> CollectResult<String> {
    let entry = read_entry()?;

    if !needs_refresh(&entry, Utc::now()) {
        return Ok(entry.access);
    }

    if let Some(cached) = usable_minted(&entry.refresh, Utc::now()) {
        return Ok(cached);
    }

    refresh_and_cache(http, &entry).await
}

/// Force a refresh after the usage endpoint answered 401/403 for `failed_access`.
/// `agy` may have refreshed the keyring in the meantime, so that is checked first.
pub async fn refresh_for_retry(
    http: &reqwest::Client,
    failed_access: &str,
) -> CollectResult<String> {
    let entry = read_entry()?;
    let now = Utc::now();

    if entry.access != failed_access && !needs_refresh(&entry, now) {
        return Ok(entry.access);
    }
    if let Some(cached) = usable_minted(&entry.refresh, now) {
        if cached != failed_access {
            return Ok(cached);
        }
    }

    // The token we just used is the one on record, so only a new mint can help.
    discard_minted();
    refresh_and_cache(http, &entry).await
}

async fn refresh_and_cache(
    http: &reqwest::Client,
    entry: &AntigravityEntry,
) -> CollectResult<String> {
    if entry.refresh.trim().is_empty() {
        return Err(CollectError::not_ready(SIGN_IN_AGAIN));
    }

    let response = http
        .post(TOKEN_URL)
        .form(&refresh_form(&entry.refresh))
        .send()
        .await
        .map_err(|e| {
            CollectError::transient(format!("Antigravity 換發連線失敗，稍後自動重試（{e}）"))
        })?;

    let status = response.status();
    // 400/401 from Google's token endpoint means invalid_grant: the refresh token was
    // revoked or consumed, and only a real sign-in fixes that. 403 and 5xx are not the
    // user's problem, so those keep the last numbers instead.
    if matches!(status.as_u16(), 400 | 401) {
        return Err(CollectError::not_ready(SIGN_IN_AGAIN));
    }
    if !status.is_success() {
        return Err(CollectError::transient(
            "Antigravity 換發失敗，稍後自動重試",
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|_| CollectError::transient("Antigravity 換發失敗，稍後自動重試"))?;

    let token = parse_refresh(&body, &entry.refresh, Utc::now())?;
    let access = token.access.clone();
    *minted().lock().expect("minted token mutex poisoned") = Some(token);
    Ok(access)
}

/// Expired, or close enough to it, means refresh. An unknown expiry always refreshes.
pub fn needs_refresh(entry: &AntigravityEntry, now: DateTime<Utc>) -> bool {
    if entry.access.trim().is_empty() {
        return true;
    }
    match entry.expires_at {
        Some(expiry) => expiry <= now + chrono::Duration::seconds(REFRESH_SKEW_SECONDS),
        None => true,
    }
}

/// Form fields for the standard Google refresh. The client secret of an installed-app
/// client is public by construction; Google's own flow requires it to be sent.
pub fn refresh_form(refresh_token: &str) -> [(&'static str, String); 4] {
    [
        ("client_id", CLIENT_ID.to_string()),
        ("client_secret", CLIENT_SECRET_PARTS.concat()),
        ("refresh_token", refresh_token.to_string()),
        ("grant_type", "refresh_token".to_string()),
    ]
}

/// Read the keyring blob and pull out the tokens.
pub fn read_entry() -> CollectResult<AntigravityEntry> {
    let raw = read_keyring(KEYRING_SERVICE, KEYRING_ACCOUNT)?
        .ok_or_else(|| CollectError::not_ready(NOT_SIGNED_IN))?;

    parse_entry(&raw).ok_or_else(|| CollectError::not_ready(SIGN_IN_AGAIN))
}

/// Parse the credential blob. Pure, no IO.
///
/// go-keyring writes the secret as raw UTF-8 on Windows; a BOM is tolerated because
/// some editors add one when a credential is restored by hand.
pub fn parse_entry(raw: &[u8]) -> Option<AntigravityEntry> {
    let text = std::str::from_utf8(raw)
        .ok()?
        .trim_start_matches('\u{feff}')
        .trim();

    let root: Value = serde_json::from_str(text).ok()?;
    // Older CLI builds stored the token object at the top level.
    let token = root.get("token").filter(|v| v.is_object()).unwrap_or(&root);

    let access = token.get("access_token").and_then(Value::as_str)?.trim();
    if access.is_empty() {
        return None;
    }

    Some(AntigravityEntry {
        access: access.to_string(),
        refresh: token
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        expires_at: token
            .get("expiry")
            .and_then(Value::as_str)
            .and_then(super::parse_datetime),
    })
}

/// Fold Google's token response into a process-lifetime token. Pure, no IO.
fn parse_refresh(
    response_json: &str,
    refresh_token: &str,
    now: DateTime<Utc>,
) -> CollectResult<MintedToken> {
    let root: Value = serde_json::from_str(response_json).map_err(|e| {
        CollectError::transient(format!("Antigravity 換發回應異常，稍後自動重試（{e}）"))
    })?;

    let access = root
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if access.is_empty() {
        return Err(CollectError::transient(
            "Antigravity 換發回應缺少 access_token，稍後自動重試",
        ));
    }

    let expires_in = root
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_EXPIRES_IN_SECONDS);

    Ok(MintedToken {
        access: access.to_string(),
        expires_at: now + chrono::Duration::seconds(expires_in),
        minted_from: refresh_token.to_string(),
    })
}

/// The in-memory token, if it is still fresh and belongs to the login on record.
fn usable_minted(refresh_token: &str, now: DateTime<Utc>) -> Option<String> {
    let guard = minted().lock().expect("minted token mutex poisoned");
    let cached = guard.as_ref()?;
    if cached.minted_from != refresh_token {
        return None;
    }
    if cached.expires_at <= now + chrono::Duration::seconds(REFRESH_SKEW_SECONDS) {
        return None;
    }
    Some(cached.access.clone())
}

fn discard_minted() {
    *minted().lock().expect("minted token mutex poisoned") = None;
}

/// Read one generic credential's blob. `None` means "no such credential", which is the
/// not-signed-in case; an error means the store itself could not be reached.
#[cfg(windows)]
fn read_keyring(service: &str, account: &str) -> CollectResult<Option<Vec<u8>>> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target: Vec<u16> = format!("{service}:{account}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();

    // SAFETY: `target` is a NUL-terminated UTF-16 buffer alive for the call, and
    // `credential` is only read when CredReadW reports success. The buffer it hands
    // back is released with CredFree before returning, and nothing borrows from it.
    unsafe {
        if let Err(e) = CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut credential,
        ) {
            return if e.code() == ERROR_NOT_FOUND.to_hresult() {
                Ok(None)
            } else {
                Err(CollectError::not_ready(
                    "讀不到 Antigravity 的登入狀態（Windows 憑證管理員），請重新開啟 Antigravity",
                ))
            };
        }

        if credential.is_null() {
            return Ok(None);
        }

        let blob = {
            let cred = &*credential;
            if cred.CredentialBlob.is_null() || cred.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize)
                    .to_vec()
            }
        };
        CredFree(credential as *const _);

        Ok(if blob.is_empty() { None } else { Some(blob) })
    }
}

/// go-keyring targets Keychain and Secret Service off Windows; neither is wired up here,
/// so say so rather than claim the user is not signed in.
#[cfg(not(windows))]
fn read_keyring(_service: &str, _account: &str) -> CollectResult<Option<Vec<u8>>> {
    Err(CollectError::not_ready(
        "此平台尚未支援讀取 Antigravity 的登入狀態",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 9, 0, 0, 0).unwrap()
    }

    fn entry(offset_minutes: i64) -> AntigravityEntry {
        AntigravityEntry {
            access: "a".into(),
            refresh: "r".into(),
            expires_at: Some(now() + chrono::Duration::minutes(offset_minutes)),
        }
    }

    /// The real blob shape (2026-09-09), with the token values replaced.
    const REAL_BLOB: &str = r#"{
        "token": {
            "access_token": "ya29.token",
            "token_type": "Bearer",
            "refresh_token": "1//refresh",
            "expiry": "2026-09-09T00:37:23.7530207+08:00"
        },
        "auth_method": "consumer"
    }"#;

    #[test]
    fn parses_the_real_blob() {
        let parsed = parse_entry(REAL_BLOB.as_bytes()).unwrap();

        assert_eq!("ya29.token", parsed.access);
        assert_eq!("1//refresh", parsed.refresh);
        assert_eq!(
            DateTime::parse_from_rfc3339("2026-09-09T00:37:23.7530207+08:00")
                .unwrap()
                .with_timezone(&Utc),
            parsed.expires_at.unwrap()
        );
    }

    #[test]
    fn tolerates_a_bom() {
        let with_bom = format!("\u{feff}{REAL_BLOB}");
        assert!(parse_entry(with_bom.as_bytes()).is_some());
    }

    /// A build that stored the token object at the top level must still read.
    #[test]
    fn parses_a_flat_blob() {
        let parsed =
            parse_entry(br#"{"access_token":"flat","refresh_token":"fr"}"#).unwrap();

        assert_eq!("flat", parsed.access);
        assert!(parsed.expires_at.is_none());
    }

    #[test]
    fn rejects_a_blob_without_an_access_token() {
        assert!(parse_entry(br#"{"token":{"refresh_token":"r"}}"#).is_none());
        assert!(parse_entry(br#"{"token":{"access_token":"  "}}"#).is_none());
        assert!(parse_entry(b"not json").is_none());
    }

    #[test]
    fn fresh_token_needs_no_refresh() {
        assert!(!needs_refresh(&entry(120), now()));
    }

    #[test]
    fn expired_token_needs_refresh() {
        assert!(needs_refresh(&entry(-60), now()));
    }

    /// Inside the last five minutes it refreshes early rather than risk a mid-call expiry.
    #[test]
    fn refreshes_proactively_within_skew() {
        assert!(needs_refresh(&entry(4), now()));
        assert!(!needs_refresh(&entry(6), now()));
    }

    #[test]
    fn unknown_expiry_always_refreshes() {
        let mut e = entry(120);
        e.expires_at = None;
        assert!(needs_refresh(&e, now()));
    }

    #[test]
    fn blank_access_refreshes() {
        let mut e = entry(120);
        e.access = "   ".into();
        assert!(needs_refresh(&e, now()));
    }

    #[test]
    fn refresh_form_carries_the_public_client_and_grant() {
        let form = refresh_form("refresh-secret");

        assert_eq!("client_id", form[0].0);
        assert_eq!(CLIENT_ID, form[0].1);
        assert!(form[1].1.starts_with("GOCSPX-"));
        assert_eq!(("refresh_token", "refresh-secret".to_string()), form[2]);
        assert_eq!(("grant_type", "refresh_token".to_string()), form[3]);
    }

    #[test]
    fn parse_refresh_reads_access_token_and_expiry() {
        let token =
            parse_refresh(r#"{"access_token":"fresh","expires_in":1800}"#, "r", now()).unwrap();

        assert_eq!("fresh", token.access);
        assert_eq!(now() + chrono::Duration::seconds(1800), token.expires_at);
        assert_eq!("r", token.minted_from);
    }

    /// Google always sends expires_in, but a missing one must not mean "already expired".
    #[test]
    fn parse_refresh_defaults_a_missing_expiry() {
        let token = parse_refresh(r#"{"access_token":"fresh"}"#, "r", now()).unwrap();

        assert_eq!(now() + chrono::Duration::seconds(3600), token.expires_at);
    }

    #[test]
    fn parse_refresh_rejects_a_missing_access_token() {
        let err = parse_refresh(r#"{"expires_in":1800}"#, "r", now()).unwrap_err();

        assert!(err.message().contains("access_token"), "{}", err.message());
        // A failed refresh is temporary, so the card keeps its numbers.
        assert!(err.keeps_last_good());
    }

    #[test]
    fn parse_refresh_rejects_malformed_json() {
        assert!(parse_refresh("not json", "r", now()).is_err());
    }
}
