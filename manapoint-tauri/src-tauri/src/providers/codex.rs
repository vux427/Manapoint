//! Codex's five-hour and weekly usage.
//!
//! Credentials come from the user's own Codex CLI login; when they lapse the card keeps
//! its numbers and shows an instruction. The response carries account details such as an
//! email address — only the usage fields are read, nothing else is retained.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;

use super::{integer, number, object};
use crate::error::{CollectError, CollectResult};
use crate::model::{ProviderUsage, UsageWindow, UsageWindowKind};
use crate::paths;

pub const PROVIDER_NAME: &str = "Codex";

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

const ONE_DAY: i64 = 86_400;
const TEN_DAYS: i64 = 864_000;

pub async fn collect(http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    let (access_token, account_id) = read_credentials()?;

    let response = http
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("chatgpt-account-id", account_id)
        .send()
        .await?;

    if matches!(response.status().as_u16(), 401 | 403) {
        return Err(CollectError::not_ready("登入已過期，請重新執行 codex 登入"));
    }

    let body = response.error_for_status()?.text().await?;
    parse(&body, Utc::now())
}

/// Parse the `GET /backend-api/wham/usage` response. Pure, no IO.
pub fn parse(json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;
    let rate_limit = object(&root, "rate_limit", "Codex usage")?;

    let mut windows = Vec::with_capacity(2);
    windows.push(
        read_window(rate_limit, "primary_window")?
            .ok_or_else(|| CollectError::failed("Codex usage 回應缺少 'primary_window'。"))?,
    );

    // Some plans have no second window.
    if let Some(secondary) = read_window(rate_limit, "secondary_window")? {
        windows.push(secondary);
    }

    Ok(ProviderUsage::new(PROVIDER_NAME, windows, collected_at))
}

fn read_window(rate_limit: &Value, key: &str) -> CollectResult<Option<UsageWindow>> {
    let Some(w) = rate_limit.get(key).filter(|v| !v.is_null()) else {
        return Ok(None);
    };

    let seconds = integer(w, "limit_window_seconds", "Codex usage")?;

    Ok(Some(UsageWindow::new(
        kind_for(seconds),
        number(w, "used_percent", "Codex usage")?,
        read_reset_at(w),
    )))
}

/// Classify by window length, not by field order — the two can be swapped.
fn kind_for(window_seconds: i64) -> UsageWindowKind {
    match window_seconds {
        s if s <= ONE_DAY => UsageWindowKind::Rolling,
        s if s <= TEN_DAYS => UsageWindowKind::Weekly,
        _ => UsageWindowKind::Monthly,
    }
}

fn read_reset_at(window: &Value) -> Option<DateTime<Utc>> {
    let seconds = window.get("reset_at")?.as_i64()?;
    Utc.timestamp_opt(seconds, 0).single()
}

fn read_credentials() -> CollectResult<(String, String)> {
    let text = std::fs::read_to_string(paths::codex_auth())
        .map_err(|_| CollectError::not_ready("找不到 Codex CLI，請先安裝並登入"))?;

    let root: Value = serde_json::from_str(&text)
        .map_err(|_| CollectError::not_ready("Codex 憑證檔讀不懂，請重新執行 codex 登入"))?;

    let tokens = root
        .get("tokens")
        .filter(|v| v.is_object())
        .ok_or_else(|| CollectError::not_ready("尚未登入，請執行 codex 登入"))?;

    let access = tokens.get("access_token").and_then(Value::as_str).unwrap_or("");
    let account = tokens.get("account_id").and_then(Value::as_str).unwrap_or("");

    if access.trim().is_empty() || account.trim().is_empty() {
        return Err(CollectError::not_ready("登入資料不完整，請重新執行 codex 登入"));
    }
    Ok((access.to_string(), account.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real response (2026-09-05) with the account fields stripped.
    const REAL_RESPONSE: &str = r#"
    {
      "plan_type": "team",
      "rate_limit": {
        "allowed": true,
        "limit_reached": false,
        "primary_window": {
          "used_percent": 0,
          "limit_window_seconds": 18000,
          "reset_after_seconds": 18000,
          "reset_at": 1788617477
        },
        "secondary_window": {
          "used_percent": 98,
          "limit_window_seconds": 604800,
          "reset_after_seconds": 156625,
          "reset_at": 1788756101
        }
      },
      "code_review_rate_limit": null,
      "credits": { "has_credits": false, "unlimited": false }
    }"#;

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 9, 11, 0).unwrap()
    }

    fn kinds(usage: &ProviderUsage) -> Vec<UsageWindowKind> {
        usage.windows.iter().map(|w| w.kind).collect()
    }

    #[test]
    fn maps_windows_by_duration() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(PROVIDER_NAME, usage.provider);
        assert_eq!(vec![UsageWindowKind::Rolling, UsageWindowKind::Weekly], kinds(&usage));
    }

    #[test]
    fn reads_used_percent() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(0.0, usage.windows[0].percent);
        assert_eq!(98.0, usage.windows[1].percent);
    }

    #[test]
    fn converts_unix_reset_timestamp() {
        let usage = parse(REAL_RESPONSE, at()).unwrap();

        assert_eq!(
            Utc.timestamp_opt(1788756101, 0).unwrap(),
            usage.windows[1].resets_at.unwrap()
        );
    }

    /// Swapping the two windows must not change how they are classified.
    #[test]
    fn ignores_field_order_when_classifying() {
        let swapped = r#"
        {"rate_limit":{
          "primary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_at":1788756101},
          "secondary_window":{"used_percent":20,"limit_window_seconds":18000,"reset_at":1788617477}
        }}"#;

        let usage = parse(swapped, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Weekly, UsageWindowKind::Rolling], kinds(&usage));
    }

    #[test]
    fn classifies_window_lengths() {
        for (seconds, expected) in [
            (18_000, UsageWindowKind::Rolling),
            (86_400, UsageWindowKind::Rolling),
            (604_800, UsageWindowKind::Weekly),
            (2_592_000, UsageWindowKind::Monthly),
        ] {
            let json = format!(
                r#"{{"rate_limit":{{"primary_window":{{"used_percent":1,"limit_window_seconds":{seconds},"reset_at":1788617477}}}}}}"#
            );
            assert_eq!(expected, parse(&json, at()).unwrap().windows[0].kind, "{seconds}s");
        }
    }

    #[test]
    fn allows_missing_secondary_window() {
        let json = r#"
        {"rate_limit":{"primary_window":{"used_percent":3,"limit_window_seconds":18000,"reset_at":1788617477},
                       "secondary_window":null}}"#;

        assert_eq!(1, parse(json, at()).unwrap().windows.len());
    }

    #[test]
    fn fails_when_rate_limit_missing() {
        let err = parse(r#"{"plan_type":"team"}"#, at()).unwrap_err();
        assert!(err.message().contains("rate_limit"), "{}", err.message());
    }

    #[test]
    fn fails_when_primary_window_missing() {
        let err = parse(r#"{"rate_limit":{"secondary_window":null}}"#, at()).unwrap_err();
        assert!(err.message().contains("primary_window"), "{}", err.message());
    }
}
