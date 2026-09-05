//! Grok's weekly credit pool, plus a monthly window for accounts that cap spend.
//!
//! Credentials come from the xAI OAuth login opencode already stores, so no Grok CLI is
//! needed. Note that on some accounts the opencode grant reports a monthly limit of zero
//! while the credit pool has real numbers — hence `?format=credits` rather than the
//! default shape. Expired access tokens are refreshed and written back; see
//! [`super::xai_token`].

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::{object, parse_datetime, xai_token};
use crate::error::{CollectError, CollectResult};
use crate::model::{ProviderUsage, UsageWindow, UsageWindowKind};

pub const PROVIDER_NAME: &str = "Grok";

const BILLING_URL: &str = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

pub async fn collect(http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    // Refreshes and persists a stale access token on the way through.
    let token = xai_token::access_token(http).await?;

    let response = http
        .get(BILLING_URL)
        .bearer_auth(token)
        .header("x-xai-token-auth", "xai-grok-cli")
        .header("accept", "application/json")
        .send()
        .await?;

    if matches!(response.status().as_u16(), 401 | 403) {
        return Err(CollectError::not_ready("登入已失效，請在 opencode 重新登入 xAI"));
    }

    let body = response.error_for_status()?.text().await?;
    parse(&body, Utc::now())
}

/// Parse the `GET /v1/billing?format=credits` response. Pure, no IO.
///
/// One endpoint, two shapes: the credits shape carries the weekly pool
/// (`creditUsagePercent`), the default one carries the monthly cap (`monthlyLimit` /
/// `used`). Some accounts report a zero monthly cap yet a real weekly pool, so both
/// signals are read: a weekly percentage yields WEEK, a non-zero cap adds MONTH. The
/// credits shape varies by account (prepaid and subscription expose different fields),
/// so a missing field is skipped rather than treated as a break.
pub fn parse(json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;
    let config = object(&root, "config", "Grok billing")?;

    let mut windows = Vec::with_capacity(2);

    if let Some(weekly_percent) = read_number(config, "creditUsagePercent") {
        windows.push(UsageWindow::new(
            UsageWindowKind::Weekly,
            weekly_percent.clamp(0.0, 100.0),
            read_resets_at(config),
        ));
    }

    // Without a cap there is no ratio to show, so MONTH only appears when one is set.
    let limit = read_amount(config, "monthlyLimit").unwrap_or(0.0);
    if limit > 0.0 {
        let used = read_amount(config, "used").unwrap_or(0.0);
        windows.push(UsageWindow::new(
            UsageWindowKind::Monthly,
            (used / limit * 100.0).clamp(0.0, 100.0),
            read_period_end(config),
        ));
    }

    if !windows.is_empty() {
        return Ok(ProviderUsage::new(PROVIDER_NAME, windows, collected_at));
    }

    // Neither shape had a usable signal. Saying so is more honest than a 0% bar.
    let spent = read_amount(config, "used").unwrap_or(0.0);
    let note = if spent > 0.0 {
        format!("本月已用 ${}，此帳號未設額度上限", trim_amount(spent))
    } else {
        "此帳號沒有 Grok 訂閱額度".to_string()
    };

    Ok(ProviderUsage::with_note(PROVIDER_NAME, collected_at, note))
}

fn read_number(config: &Value, key: &str) -> Option<f64> {
    config.get(key)?.as_f64().filter(|v| *v >= 0.0)
}

/// Money fields are always wrapped as `{ "val": n }`.
fn read_amount(config: &Value, key: &str) -> Option<f64> {
    config.get(key)?.get("val")?.as_f64().filter(|v| *v >= 0.0)
}

/// Reset time for the credits shape: `currentPeriod.end` first, `billingPeriodEnd` as
/// a fallback, blank if neither is present.
fn read_resets_at(config: &Value) -> Option<DateTime<Utc>> {
    config
        .get("currentPeriod")
        .and_then(|p| p.get("end"))
        .and_then(Value::as_str)
        .and_then(parse_datetime)
        .or_else(|| read_period_end(config))
}

fn read_period_end(config: &Value) -> Option<DateTime<Utc>> {
    config.get("billingPeriodEnd")?.as_str().and_then(parse_datetime)
}

/// At most two decimals, trailing zeros dropped.
fn trim_amount(value: f64) -> String {
    let text = format!("{value:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// The credits shape. Field names are real; the numbers are invented.
    const CREDITS_RESPONSE: &str = r#"
    {
      "config": {
        "currentPeriod": { "end": "2026-09-12T00:00:00+00:00" },
        "creditUsagePercent": 35.5,
        "onDemandCap": { "val": 0 },
        "onDemandUsed": { "val": 0 },
        "isUnifiedBillingUser": false,
        "billingPeriodStart": "2026-09-01T00:00:00+00:00",
        "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
      }
    }"#;

    /// The default shape, from an account with a monthly cap (verified 2026-09-05).
    const MONTHLY_RESPONSE: &str = r#"
    {
      "config": {
        "monthlyLimit": { "val": 60 },
        "used": { "val": 15 },
        "billingPeriodStart": "2026-09-01T00:00:00+00:00",
        "billingPeriodEnd": "2026-10-01T00:00:00+00:00",
        "history": []
      }
    }"#;

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 9, 11, 0).unwrap()
    }

    fn kinds(usage: &ProviderUsage) -> Vec<UsageWindowKind> {
        usage.windows.iter().map(|w| w.kind).collect()
    }

    #[test]
    fn maps_credit_percent_to_weekly() {
        let usage = parse(CREDITS_RESPONSE, at()).unwrap();

        assert_eq!(PROVIDER_NAME, usage.provider);
        assert_eq!(vec![UsageWindowKind::Weekly], kinds(&usage));
        assert_eq!(35.5, usage.windows[0].percent);
    }

    #[test]
    fn prefers_current_period_end_for_weekly_reset() {
        let usage = parse(CREDITS_RESPONSE, at()).unwrap();

        assert_eq!(
            Utc.with_ymd_and_hms(2026, 9, 12, 0, 0, 0).unwrap(),
            usage.windows[0].resets_at.unwrap()
        );
    }

    #[test]
    fn falls_back_to_billing_period_end() {
        let json = r#"{"config":{
            "creditUsagePercent": 10,
            "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert_eq!(
            Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
            usage.windows[0].resets_at.unwrap()
        );
    }

    #[test]
    fn keeps_monthly_when_limit_set() {
        let usage = parse(MONTHLY_RESPONSE, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Monthly], kinds(&usage));
        assert_eq!(25.0, usage.windows[0].percent);
    }

    /// With both signals present, both windows show, WEEK first.
    #[test]
    fn shows_both_windows_when_both_signals_present() {
        let json = r#"{"config":{
            "creditUsagePercent": 35.5,
            "monthlyLimit": { "val": 60 },
            "used": { "val": 15 },
            "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Weekly, UsageWindowKind::Monthly], kinds(&usage));
    }

    /// A missing field is skipped, not fatal: the credits shape varies by account.
    #[test]
    fn skips_missing_signals_gracefully() {
        let usage = parse(r#"{"config":{"onDemandCap": { "val": 5 }}}"#, at()).unwrap();

        assert!(usage.windows.is_empty());
        assert_eq!(Some("此帳號沒有 Grok 訂閱額度".to_string()), usage.note);
    }

    #[test]
    fn notes_spent_amount_without_limit() {
        let json = r#"{"config":{
            "monthlyLimit": { "val": 0 },
            "used": { "val": 3.5 }
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert!(usage.windows.is_empty());
        assert_eq!(Some("本月已用 $3.5，此帳號未設額度上限".to_string()), usage.note);
    }

    #[test]
    fn fails_when_config_missing() {
        let err = parse(r#"{"foo":1}"#, at()).unwrap_err();
        assert!(err.message().contains("config"), "{}", err.message());
    }

    #[test]
    fn trims_trailing_zeros_from_amounts() {
        assert_eq!("3", trim_amount(3.0));
        assert_eq!("3.5", trim_amount(3.5));
        assert_eq!("3.46", trim_amount(3.456));
    }
}
