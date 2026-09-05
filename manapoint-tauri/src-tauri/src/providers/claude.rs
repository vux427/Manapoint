//! Claude Code's five-hour and weekly usage.
//!
//! Credentials come from the user's own Claude Code login. When they expire the card
//! keeps its numbers and shows an instruction; Claude Code refreshes them on its next
//! run and the panel recovers on its own. See docs/providers.md.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;

use super::{number, object, optional_datetime};
use crate::error::{CollectError, CollectResult};
use crate::model::{ProviderUsage, UsageWindow, UsageWindowKind};
use crate::paths;

pub const PROVIDER_NAME: &str = "Claude Code";

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

const WINDOW_MAP: [(&str, UsageWindowKind); 2] = [
    ("five_hour", UsageWindowKind::Rolling),
    ("seven_day", UsageWindowKind::Weekly),
];

pub async fn collect(http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    let token = read_access_token()?;

    let response = http.get(USAGE_URL).bearer_auth(token).send().await?;
    if matches!(response.status().as_u16(), 401 | 403) {
        return Err(CollectError::not_ready(
            "登入已失效，請在 Claude Code 執行 /login",
        ));
    }

    let body = response.error_for_status()?.text().await?;
    parse(&body, Utc::now())
}

/// Parse the `GET /api/oauth/usage` response. Pure, no IO.
pub fn parse(json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;

    let mut windows = Vec::with_capacity(WINDOW_MAP.len());
    for (key, kind) in WINDOW_MAP {
        let w = object(&root, key, &format!("Claude usage 的 '{key}' 窗口"))
            .map_err(|_| CollectError::failed(format!("Claude usage 回應缺少 '{key}' 窗口。")))?;

        windows.push(UsageWindow::new(
            kind,
            number(w, "utilization", "Claude usage")?,
            // Claude returns a null reset time for some windows.
            optional_datetime(w, "resets_at"),
        ));
    }

    Ok(ProviderUsage::new(PROVIDER_NAME, windows, collected_at))
}

fn read_access_token() -> CollectResult<String> {
    let path = paths::claude_credentials();
    let text = std::fs::read_to_string(&path)
        .map_err(|_| CollectError::not_ready("找不到 Claude Code，請先安裝並執行 /login"))?;

    let root: Value = serde_json::from_str(&text)
        .map_err(|_| CollectError::not_ready("Claude Code 憑證檔讀不懂，請重新執行 /login"))?;

    let oauth = root
        .get("claudeAiOauth")
        .filter(|v| v.is_object())
        .ok_or_else(|| CollectError::not_ready("尚未登入，請在 Claude Code 執行 /login"))?;

    if let Some(expires_ms) = oauth.get("expiresAt").and_then(Value::as_i64) {
        if Utc
            .timestamp_millis_opt(expires_ms)
            .single()
            .is_some_and(|t| t <= Utc::now())
        {
            return Err(CollectError::not_ready(
                "登入已過期，請開啟 Claude Code 重新整理登入",
            ));
        }
    }

    match oauth.get("accessToken").and_then(Value::as_str) {
        Some(token) if !token.trim().is_empty() => Ok(token.to_string()),
        _ => Err(CollectError::not_ready(
            "尚未登入，請在 Claude Code 執行 /login",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real response (2026-09-05), extra fields kept so a shape change shows up here.
    const REAL_RESPONSE: &str = r#"
    {
      "five_hour": {
        "utilization": 5.0,
        "resets_at": "2026-09-05T20:00:00.469547+08:00",
        "limit_dollars": null, "used_dollars": null, "locked_reason": null
      },
      "seven_day": {
        "utilization": 1.0,
        "resets_at": "2026-09-11T09:00:00.469575+08:00",
        "limit_dollars": null, "used_dollars": null, "locked_reason": null
      },
      "seven_day_opus": null,
      "nimbus_quill": { "utilization": 0.0, "resets_at": null },
      "member_dashboard_available": false
    }"#;

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 8, 57, 0).unwrap()
    }

    #[test]
    fn returns_five_hour_then_weekly() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(PROVIDER_NAME, usage.provider);
        assert_eq!(
            vec![UsageWindowKind::Rolling, UsageWindowKind::Weekly],
            usage.windows.iter().map(|w| w.kind).collect::<Vec<_>>()
        );
    }

    #[test]
    fn reads_fractional_utilisation() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(5.0, usage.windows[0].percent);
        assert_eq!(1.0, usage.windows[1].percent);
    }

    /// An offset timestamp must land on the same instant in UTC.
    #[test]
    fn keeps_reset_instant_across_offset() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(
            DateTime::parse_from_rfc3339("2026-09-05T20:00:00.469547+08:00")
                .unwrap()
                .with_timezone(&Utc),
            usage.windows[0].resets_at.unwrap()
        );
    }

    #[test]
    fn fails_when_window_missing() {
        let err = parse(r#"{"five_hour":{"utilization":5,"resets_at":null}}"#, at()).unwrap_err();

        assert!(err.message().contains("seven_day"), "{}", err.message());
    }

    #[test]
    fn fails_when_window_is_explicit_null() {
        assert!(parse(r#"{"five_hour":null,"seven_day":null}"#, at()).is_err());
    }

    #[test]
    fn allows_null_reset_timestamp() {
        let json = r#"{"five_hour":{"utilization":2.5,"resets_at":null},
                       "seven_day":{"utilization":0,"resets_at":null}}"#;
        let usage = parse(json, at()).unwrap();

        assert!(usage.windows[0].resets_at.is_none());
        assert_eq!(2.5, usage.windows[0].percent);
    }

    /// Malformed JSON breaks this one card, never the whole polling round.
    #[test]
    fn malformed_json_is_a_failure_not_a_panic() {
        assert!(parse("not json", at()).is_err());
    }
}
