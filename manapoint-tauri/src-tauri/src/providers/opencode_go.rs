//! opencode Go's rolling, weekly and monthly windows.
//!
//! Uses the login the opencode CLI already has; this app never asks for an API key.

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::{number, object, parse_datetime};
use crate::error::{CollectError, CollectResult};
use crate::model::{ProviderUsage, UsageWindow, UsageWindowKind};
use crate::paths;

pub const PROVIDER_NAME: &str = "opencode Go";

const USAGE_URL: &str = "https://opencode.ai/zen/go/v1/usage";

const WINDOW_MAP: [(&str, UsageWindowKind); 3] = [
    ("rolling", UsageWindowKind::Rolling),
    ("weekly", UsageWindowKind::Weekly),
    ("monthly", UsageWindowKind::Monthly),
];

pub async fn collect(http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    let key = read_api_key()?;

    let body = http
        .get(USAGE_URL)
        .bearer_auth(key)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    parse(&body, Utc::now())
}

/// Parse the `GET /zen/go/v1/usage` response. A shape mismatch is an error, not
/// something to paper over.
pub fn parse(json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;
    let usage = object(&root, "usage", "opencode Go usage")
        .map_err(|_| CollectError::failed("opencode Go usage 回應缺少 'usage' 欄位。"))?;

    let mut windows = Vec::with_capacity(WINDOW_MAP.len());
    for (key, kind) in WINDOW_MAP {
        let w = usage.get(key).filter(|v| !v.is_null()).ok_or_else(|| {
            CollectError::failed(format!("opencode Go usage 回應缺少 '{key}' 窗口。"))
        })?;

        let resets_at = w
            .get("resetsAt")
            .and_then(Value::as_str)
            .and_then(parse_datetime)
            .ok_or_else(|| {
                CollectError::failed(format!("opencode Go usage 的 '{key}' 缺少 resetsAt。"))
            })?;

        windows.push(UsageWindow::new(
            kind,
            number(w, "percent", "opencode Go usage")?,
            Some(resets_at),
        ));
    }

    Ok(ProviderUsage::new(PROVIDER_NAME, windows, collected_at))
}

/// Read the Go API key the opencode CLI stores. Absent means "not signed in".
fn read_api_key() -> CollectResult<String> {
    let text = std::fs::read_to_string(paths::opencode_auth())
        .map_err(|_| CollectError::not_ready("找不到 opencode，請先安裝並登入"))?;

    let root: Value = serde_json::from_str(&text)
        .map_err(|_| CollectError::not_ready("opencode 憑證檔讀不懂，請重新登入"))?;

    let entry = root
        .get("opencode-go")
        .filter(|v| v.is_object())
        .ok_or_else(|| CollectError::not_ready("尚未登入 opencode Go"))?;

    match entry.get("key").and_then(Value::as_str) {
        Some(key) if !key.trim().is_empty() => Ok(key.to_string()),
        _ => Err(CollectError::not_ready("opencode Go 的登入資料不完整，請重新登入")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// A real response (2026-09-05).
    const REAL_RESPONSE: &str = r#"
    {
      "usage": {
        "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-09-05T13:38:32.096Z" },
        "weekly":  { "status": "ok", "percent": 15, "resetsAt": "2026-09-07T00:00:00.096Z" },
        "monthly": { "status": "ok", "percent": 24, "resetsAt": "2026-09-10T06:10:40.096Z" }
      }
    }"#;

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 8, 38, 32).unwrap()
    }

    #[test]
    fn returns_three_windows_in_order() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(PROVIDER_NAME, usage.provider);
        assert_eq!(at(), usage.collected_at);
        assert_eq!(
            vec![
                UsageWindowKind::Rolling,
                UsageWindowKind::Weekly,
                UsageWindowKind::Monthly
            ],
            usage.windows.iter().map(|w| w.kind).collect::<Vec<_>>()
        );
    }

    #[test]
    fn reads_percent() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(0.0, usage.windows[0].percent);
        assert_eq!(15.0, usage.windows[1].percent);
        assert_eq!(24.0, usage.windows[2].percent);
    }

    #[test]
    fn reads_reset_timestamp_as_utc() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(
            Utc.with_ymd_and_hms(2026, 9, 7, 0, 0, 0).unwrap()
                + chrono::Duration::milliseconds(96),
            usage.windows[1].resets_at.unwrap()
        );
    }

    #[test]
    fn fails_when_usage_key_missing() {
        let err = parse(r#"{"other":{}}"#, at()).unwrap_err();
        assert!(err.message().contains("usage"), "{}", err.message());
    }

    #[test]
    fn fails_when_window_missing() {
        let json = r#"
        {"usage":{
          "rolling":{"percent":0,"resetsAt":"2026-09-05T13:38:32Z"},
          "weekly":{"percent":15,"resetsAt":"2026-09-07T00:00:00Z"}
        }}"#;

        let err = parse(json, at()).unwrap_err();
        assert!(err.message().contains("monthly"), "{}", err.message());
    }

    #[test]
    fn fails_on_malformed_json() {
        assert!(parse("not json", at()).is_err());
    }
}
