//! Grok's weekly credit pool, plus a monthly window for accounts that cap spend.
//!
//! Credentials come from the xAI OAuth login opencode already stores, so no Grok CLI is
//! needed. Note that on some accounts the opencode grant reports a monthly limit of zero
//! while the credit pool has real numbers — hence `?format=credits` rather than the
//! default shape. SuperGrok (unified billing) accounts expose the weekly pool either as
//! a top-level `creditUsagePercent` or per product in `productUsage[].usagePercent`;
//! xAI omits zero-valued percentage fields, so a unified weekly bill with every
//! amount at zero reads as 0% used (fresh pool), not as "no quota". Expired access
//! tokens are refreshed and written back; see [`super::xai_token`].

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
/// One endpoint, three signals: two for the weekly pool (the top-level
/// `creditUsagePercent`, else the max of `productUsage[].usagePercent` — SuperGrok
/// accounts expose the pool per product, e.g. GrokBuild, and sometimes omit the
/// top-level field), plus the default shape's monthly cap (`monthlyLimit` / `used`). Some accounts report a
/// zero monthly cap yet a real weekly pool, so both signals are read: a weekly
/// percentage yields WEEK, a non-zero cap adds MONTH. The credits shape varies by
/// account (prepaid, unified billing and subscription expose different fields), so a
/// missing field is skipped rather than treated as a break.
pub fn parse(json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;
    let config = object(&root, "config", "Grok billing")?;

    let mut windows = Vec::with_capacity(2);

    if let Some(weekly_percent) = read_weekly_percent(config) {
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

    // A unified-billing (SuperGrok) account with a weekly period but no percentage
    // fields: when every amount on the bill is zero the pool is simply untouched —
    // xAI omits zero-valued percentage fields, so 0% used is the honest reading and
    // the card keeps working across the weekly reset. Any non-zero amount without a
    // percentage means the endpoint withheld a number; synthesising 0% there would be
    // a fabrication (and claiming "no quota" would be wrong either way).
    if is_unified_weekly(config) {
        if amounts_all_zero(config) {
            let mut usage = ProviderUsage::new(
                PROVIDER_NAME,
                vec![UsageWindow::new(
                    UsageWindowKind::Weekly,
                    0.0,
                    read_resets_at(config),
                )],
                collected_at,
            );
            usage.note = Some("本週期尚無用量".to_string());
            return Ok(usage);
        }
        return Ok(ProviderUsage::with_note(
            PROVIDER_NAME,
            collected_at,
            unified_note(config),
        ));
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

/// Weekly pool percent: `creditUsagePercent` first, else the max of
/// `productUsage[].usagePercent`. Entries without a numeric `usagePercent`
/// (e.g. `{"product":"GrokChat"}`) are skipped.
fn read_weekly_percent(config: &Value) -> Option<f64> {
    if let Some(top) = read_number(config, "creditUsagePercent") {
        return Some(top);
    }
    config
        .get("productUsage")?
        .as_array()?
        .iter()
        .filter_map(|p| p.get("usagePercent")?.as_f64().filter(|v| *v >= 0.0))
        .fold(None, |acc: Option<f64>, v| Some(acc.map_or(v, |a| a.max(v))))
}

/// Unified-billing accounts (SuperGrok) report `isUnifiedBillingUser: true` with a
/// weekly `currentPeriod`, even when no percentage field is present.
fn is_unified_weekly(config: &Value) -> bool {
    let unified = config
        .get("isUnifiedBillingUser")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let weekly = config
        .get("currentPeriod")
        .and_then(|p| p.get("type"))
        .and_then(Value::as_str)
        .map_or(false, |t| t.contains("WEEKLY"));
    unified && weekly
}

fn unified_note(config: &Value) -> String {
    const BASE: &str = "SuperGrok 統一帳單，帳務端未回傳用量百分比";
    match read_resets_at(config) {
        Some(reset) => format!("{}（下次重置 {}）", BASE, reset.format("%Y-%m-%d")),
        None => BASE.to_string(),
    }
}

/// Every billable amount xAI reports. Absent counts as zero, matching the
/// endpoint's zero-omission; a plain number is accepted too in case the `{val}`
/// wrapper ever changes.
fn amounts_all_zero(config: &Value) -> bool {
    const AMOUNTS: [&str; 5] = [
        "monthlyLimit",
        "used",
        "onDemandCap",
        "onDemandUsed",
        "prepaidBalance",
    ];
    AMOUNTS.iter().all(|key| {
        let wrapped = config.get(key).and_then(|v| v.get("val"));
        let raw = wrapped.or_else(|| config.get(key));
        match raw.and_then(Value::as_f64) {
            Some(v) => v == 0.0,
            None => true,
        }
    })
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

    /// SuperGrok accounts sometimes omit the top-level percent but report the pool
    /// per product. Entries without a numeric usagePercent are skipped.
    #[test]
    fn maps_product_usage_to_weekly_when_top_level_missing() {
        let json = r#"{"config":{
            "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY", "end": "2026-09-17T08:41:03+00:00" },
            "productUsage": [{"product": "GrokBuild", "usagePercent": 45.0}, {"product": "GrokChat"}],
            "isUnifiedBillingUser": true,
            "billingPeriodEnd": "2026-09-17T08:41:03+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Weekly], kinds(&usage));
        assert_eq!(45.0, usage.windows[0].percent);
    }

    /// When both are present the top-level combined pool wins.
    #[test]
    fn prefers_top_level_percent_over_product_usage() {
        let json = r#"{"config":{
            "creditUsagePercent": 75.0,
            "productUsage": [{"product": "GrokBuild", "usagePercent": 45.0}],
            "billingPeriodEnd": "2026-10-01T00:00:00+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Weekly], kinds(&usage));
        assert_eq!(75.0, usage.windows[0].percent);
    }

    /// A unified-billing (SuperGrok) weekly account with every amount at zero is a
    /// fresh pool — xAI omits zero-valued percent fields, so this reads as 0% used.
    /// Shape observed live 2026-09-10 (amounts are all zero, no PII).
    #[test]
    fn reads_fresh_zero_unified_weekly_as_zero_percent() {
        let json = r#"{"config":{
            "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY",
                "start": "2026-09-10T08:41:03.094066+00:00",
                "end": "2026-09-17T08:41:03.094066+00:00"
            },
            "onDemandCap": { "val": 0 },
            "onDemandUsed": { "val": 0 },
            "isUnifiedBillingUser": true,
            "prepaidBalance": { "val": 0 },
            "topUpMethod": "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
            "billingPeriodStart": "2026-09-10T08:41:03.094066+00:00",
            "billingPeriodEnd": "2026-09-17T08:41:03.094066+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert_eq!(vec![UsageWindowKind::Weekly], kinds(&usage));
        assert_eq!(0.0, usage.windows[0].percent);
        assert_eq!(
            "2026-09-17T08:41:03",
            usage.windows[0].resets_at.unwrap().format("%Y-%m-%dT%H:%M:%S").to_string()
        );
        assert_eq!(Some("本週期尚無用量".to_string()), usage.note);
    }

    /// Any non-zero amount without a percentage means the endpoint withheld a
    /// number: report it as unavailable, never synthesise 0%.
    #[test]
    fn notes_unified_weekly_without_percent_as_unavailable() {
        let json = r#"{"config":{
            "currentPeriod": {
                "type": "USAGE_PERIOD_TYPE_WEEKLY",
                "start": "2026-09-10T08:41:03.094066+00:00",
                "end": "2026-09-17T08:41:03.094066+00:00"
            },
            "onDemandCap": { "val": 100 },
            "onDemandUsed": { "val": 0 },
            "isUnifiedBillingUser": true,
            "prepaidBalance": { "val": 0 },
            "billingPeriodStart": "2026-09-10T08:41:03.094066+00:00",
            "billingPeriodEnd": "2026-09-17T08:41:03.094066+00:00"
        }}"#;

        let usage = parse(json, at()).unwrap();

        assert!(usage.windows.is_empty());
        assert_eq!(
            Some("SuperGrok 統一帳單，帳務端未回傳用量百分比（下次重置 2026-09-17）".to_string()),
            usage.note
        );
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
