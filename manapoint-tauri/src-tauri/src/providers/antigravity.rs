//! Antigravity's two shared quota pools.
//!
//! One request answers for both cards: `retrieveUserQuotaSummary` returns four buckets in
//! two groups — Gemini models share a 5-hour and a weekly limit, Claude/GPT models share
//! another pair. Manapoint's window model has one 5-hour and one weekly slot per card, so
//! each pool gets its own card and the response is fetched once and shared between them
//! (see [`SUMMARY_TTL`]).
//!
//! Credentials come from the user's own Antigravity login, which `agy` keeps in the OS
//! keyring rather than a file; see [`super::antigravity_token`]. The response carries no
//! account identifiers, only the buckets below.
//!
//! Endpoint and OAuth client verified against the MIT-licensed
//! [lamchun1110/UsageDeck](https://github.com/lamchun1110/UsageDeck)
//! (`src-tauri/src/providers/antigravity`) and confirmed live on 2026-09-09.

use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::Value;
use tokio::sync::{Mutex, OnceCell};

use super::{antigravity_token, parse_datetime};
use crate::error::{CollectError, CollectResult};
use crate::model::{ProviderUsage, UsageWindow, UsageWindowKind};

pub const GEMINI_NAME: &str = "Antigravity Gemini";
pub const THIRD_PARTY_NAME: &str = "Antigravity Claude/GPT";

/// Tried in order, and the order matters. `agy` itself talks to the `daily-` host, and
/// only that one meters the Gemini pool: the plain host answers with a placeholder —
/// `remainingFraction: 1` and a `resetTime` recomputed as "now + window", i.e. a window
/// that never started — while reporting the Claude/GPT pool a little stale as well
/// (66.13% against the daily host's 66.64%, measured 2026-09-09 seconds apart). The
/// plain host stays as a fallback for the day the `daily-` one goes away.
const SUMMARY_HOSTS: [&str; 2] = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
];

const SUMMARY_PATH: &str = "/v1internal:retrieveUserQuotaSummary";

/// The `agy` CLI identifies itself with this; the endpoint is picky about a client name.
const USER_AGENT: &str = "antigravity";

/// Long enough that the two cards of one poll round share a single request, short enough
/// that a manual refresh still goes to the network. Polling runs every five minutes.
const SUMMARY_TTL: Duration = Duration::from_secs(30);

/// Which group of models a card reports on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pool {
    /// "Gemini Models" — Gemini Flash and Pro.
    Gemini,
    /// "Claude and GPT models" — the non-Gemini group.
    ThirdParty,
}

impl Pool {
    pub fn name(self) -> &'static str {
        match self {
            Self::Gemini => GEMINI_NAME,
            Self::ThirdParty => THIRD_PARTY_NAME,
        }
    }

    /// The bucket ids this pool draws from, in display order.
    fn buckets(self) -> [(&'static str, UsageWindowKind); 2] {
        match self {
            Self::Gemini => [
                ("gemini-5h", UsageWindowKind::Rolling),
                ("gemini-weekly", UsageWindowKind::Weekly),
            ],
            Self::ThirdParty => [
                ("3p-5h", UsageWindowKind::Rolling),
                ("3p-weekly", UsageWindowKind::Weekly),
            ],
        }
    }
}

struct CachedSummary {
    fetched_at: Instant,
    body: String,
}

/// Serialises the fetch so the two cards of one round cost one round trip. Holding the
/// lock across the request is deliberate: the second card would have waited for its own
/// response anyway, and this way it waits for the first one instead.
fn summary_cache() -> &'static OnceCell<Mutex<Option<CachedSummary>>> {
    static CACHE: OnceCell<Mutex<Option<CachedSummary>>> = OnceCell::const_new();
    &CACHE
}

pub async fn collect(pool: Pool, http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    let body = summary(http).await?;
    parse(pool, &body, Utc::now())
}

/// The quota summary, from cache when a sibling card just fetched it.
async fn summary(http: &reqwest::Client) -> CollectResult<String> {
    let cell = summary_cache().get_or_init(|| async { Mutex::new(None) }).await;
    let mut guard = cell.lock().await;

    if let Some(cached) = guard.as_ref() {
        if cached.fetched_at.elapsed() < SUMMARY_TTL {
            return Ok(cached.body.clone());
        }
    }

    // Refreshes a stale access token on the way through.
    let mut token = antigravity_token::access_token(http).await?;
    let mut refreshed = false;
    let mut last: Option<CollectError> = None;

    for host in SUMMARY_HOSTS {
        for _ in 0..2 {
            match fetch(http, host, &token).await {
                Ok(response) if matches!(response.status().as_u16(), 401 | 403) && !refreshed => {
                    // The token lapsed between the proactive check and the request, or
                    // `agy` signed in again. Refresh once, then retry this host.
                    refreshed = true;
                    token = antigravity_token::refresh_for_retry(http, &token).await?;
                    continue;
                }
                Ok(response) => {
                    match response.error_for_status() {
                        Ok(ok) => {
                            let body = ok.text().await?;
                            *guard = Some(CachedSummary {
                                fetched_at: Instant::now(),
                                body: body.clone(),
                            });
                            return Ok(body);
                        }
                        // A host that is gone or refuses this client is worth stepping
                        // past; only the last one's reason reaches the card.
                        Err(e) => last = Some(e.into()),
                    }
                    break;
                }
                Err(e) => {
                    last = Some(e);
                    break;
                }
            }
        }
    }

    Err(last.unwrap_or_else(|| CollectError::transient("Antigravity 額度查詢失敗，稍後自動重試")))
}

async fn fetch(
    http: &reqwest::Client,
    host: &str,
    token: &str,
) -> CollectResult<reqwest::Response> {
    Ok(http
        .post(format!("{host}{SUMMARY_PATH}"))
        .bearer_auth(token)
        .header("User-Agent", USER_AGENT)
        .header("accept", "application/json")
        .json(&serde_json::json!({}))
        .send()
        .await?)
}

/// Pull one pool's windows out of the `retrieveUserQuotaSummary` response. Pure, no IO.
///
/// Buckets are matched by `bucketId` and never by position: the groups arrive in no
/// fixed order, and an account without a given limit simply omits its bucket. A bucket
/// reports what is *left*, so the panel's "used" is `1 - remainingFraction`.
pub fn parse(pool: Pool, json: &str, collected_at: DateTime<Utc>) -> CollectResult<ProviderUsage> {
    let root: Value = serde_json::from_str(json)?;

    let buckets: Vec<&Value> = root
        .pointer("/response/groups")
        .or_else(|| root.get("groups"))
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .filter_map(|group| group.get("buckets").and_then(Value::as_array))
                .flatten()
                .collect()
        })
        .ok_or_else(|| CollectError::failed("Antigravity 額度回應缺少 'groups'。"))?;

    let mut windows = Vec::with_capacity(2);
    for (bucket_id, kind) in pool.buckets() {
        let Some(bucket) = buckets
            .iter()
            .find(|b| b.get("bucketId").and_then(Value::as_str) == Some(bucket_id))
        else {
            continue;
        };

        // A bucket that exists but reports no fraction is a shape change, not an empty
        // quota; drawing 0% there would be a fabricated number.
        let Some(remaining) = bucket.get("remainingFraction").and_then(Value::as_f64) else {
            return Err(CollectError::failed(format!(
                "Antigravity 的 '{bucket_id}' 缺少 remainingFraction。"
            )));
        };

        windows.push(UsageWindow::new(
            kind,
            (1.0 - remaining.clamp(0.0, 1.0)) * 100.0,
            bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .and_then(parse_datetime),
        ));
    }

    // No bucket at all is an account without this pool — a fact to state, not an error.
    if windows.is_empty() {
        return Ok(ProviderUsage::with_note(
            pool.name(),
            collected_at,
            "此帳號沒有這組模型的額度".to_string(),
        ));
    }

    Ok(ProviderUsage::new(pool.name(), windows, collected_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// A real response (2026-09-09), extra fields kept so a shape change shows up here.
    const REAL_RESPONSE: &str = r#"
    {
      "groups": [
        {
          "buckets": [
            { "bucketId": "gemini-weekly", "displayName": "Weekly Limit Remaining",
              "window": "weekly", "resetTime": "2026-09-15T16:02:03Z",
              "remainingFraction": 1 },
            { "bucketId": "gemini-5h", "displayName": "Five Hour Limit Remaining",
              "window": "5h", "resetTime": "2026-09-08T21:02:03Z",
              "remainingFraction": 1 }
          ],
          "displayName": "Gemini Models",
          "description": "Models within this group: Gemini Flash, Gemini Pro"
        },
        {
          "buckets": [
            { "bucketId": "3p-weekly", "displayName": "Weekly Limit Remaining",
              "window": "weekly", "resetTime": "2026-09-15T15:58:51Z",
              "description": "You have used some of your weekly limit.",
              "remainingFraction": 0.93986666 },
            { "bucketId": "3p-5h", "displayName": "Five Hour Limit Remaining",
              "window": "5h", "resetTime": "2026-09-08T20:58:51Z",
              "remainingFraction": 0.8302704 }
          ],
          "displayName": "Claude and GPT models",
          "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS"
        }
      ],
      "description": "Within each group, models share a weekly limit and a 5-hour limit."
    }"#;

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 9, 0, 0, 0).unwrap()
    }

    #[test]
    fn returns_five_hour_then_weekly() {
        let usage = parse(Pool::Gemini, REAL_RESPONSE, at()).unwrap();

        assert_eq!(GEMINI_NAME, usage.provider);
        assert_eq!(
            vec![UsageWindowKind::Rolling, UsageWindowKind::Weekly],
            usage.windows.iter().map(|w| w.kind).collect::<Vec<_>>()
        );
    }

    /// The buckets arrive weekly-first; matching must be by id, not by position.
    #[test]
    fn converts_remaining_fraction_to_used_percent() {
        let usage = parse(Pool::ThirdParty, REAL_RESPONSE, at()).unwrap();

        assert_eq!(THIRD_PARTY_NAME, usage.provider);
        assert!((usage.windows[0].percent - 16.97296).abs() < 1e-4);
        assert!((usage.windows[1].percent - 6.013334).abs() < 1e-4);
    }

    #[test]
    fn keeps_each_pool_separate() {
        let gemini = parse(Pool::Gemini, REAL_RESPONSE, at()).unwrap();

        assert_eq!(0.0, gemini.windows[0].percent);
        assert_eq!(0.0, gemini.windows[1].percent);
    }

    #[test]
    fn reads_reset_times() {
        let usage = parse(Pool::Gemini, REAL_RESPONSE, at()).unwrap();

        assert_eq!(
            Utc.with_ymd_and_hms(2026, 9, 8, 21, 2, 3).unwrap(),
            usage.windows[0].resets_at.unwrap()
        );
    }

    /// Some plans have only one of the two windows; the other is skipped, not faked.
    #[test]
    fn skips_a_missing_bucket() {
        let json = r#"{"groups":[{"buckets":[
            {"bucketId":"gemini-weekly","remainingFraction":0.5}
        ]}]}"#;
        let usage = parse(Pool::Gemini, json, at()).unwrap();

        assert_eq!(1, usage.windows.len());
        assert_eq!(UsageWindowKind::Weekly, usage.windows[0].kind);
        assert_eq!(50.0, usage.windows[0].percent);
    }

    /// A reset time is optional; a bucket without one still draws.
    #[test]
    fn allows_a_missing_reset_time() {
        let json = r#"{"groups":[{"buckets":[
            {"bucketId":"3p-5h","remainingFraction":0.25}
        ]}]}"#;
        let usage = parse(Pool::ThirdParty, json, at()).unwrap();

        assert_eq!(75.0, usage.windows[0].percent);
        assert!(usage.windows[0].resets_at.is_none());
    }

    /// An account with no bucket for this pool gets an explanation, not a 0% bar.
    #[test]
    fn reports_a_pool_the_account_does_not_have() {
        let json = r#"{"groups":[{"buckets":[
            {"bucketId":"gemini-5h","remainingFraction":1}
        ]}]}"#;
        let usage = parse(Pool::ThirdParty, json, at()).unwrap();

        assert!(usage.windows.is_empty());
        assert!(usage.note.is_some());
    }

    /// The language server wraps the same payload in a "response" object.
    #[test]
    fn accepts_the_wrapped_shape() {
        let json = r#"{"response":{"groups":[{"buckets":[
            {"bucketId":"gemini-5h","remainingFraction":0.4}
        ]}]}}"#;
        let usage = parse(Pool::Gemini, json, at()).unwrap();

        assert!((usage.windows[0].percent - 60.0).abs() < 1e-9);
    }

    #[test]
    fn fails_when_groups_is_missing() {
        let err = parse(Pool::Gemini, r#"{"description":"nothing here"}"#, at()).unwrap_err();

        assert!(err.message().contains("groups"), "{}", err.message());
    }

    #[test]
    fn fails_when_a_bucket_reports_no_fraction() {
        let json = r#"{"groups":[{"buckets":[{"bucketId":"gemini-5h"}]}]}"#;
        let err = parse(Pool::Gemini, json, at()).unwrap_err();

        assert!(err.message().contains("remainingFraction"), "{}", err.message());
    }

    /// Out-of-range fractions are clamped rather than drawn past the end of the bar.
    #[test]
    fn clamps_an_out_of_range_fraction() {
        let json = r#"{"groups":[{"buckets":[
            {"bucketId":"gemini-5h","remainingFraction":1.4},
            {"bucketId":"gemini-weekly","remainingFraction":-0.2}
        ]}]}"#;
        let usage = parse(Pool::Gemini, json, at()).unwrap();

        assert_eq!(0.0, usage.windows[0].percent);
        assert_eq!(100.0, usage.windows[1].percent);
    }

    /// Malformed JSON breaks this one card, never the whole polling round.
    #[test]
    fn malformed_json_is_a_failure_not_a_panic() {
        assert!(parse(Pool::Gemini, "not json", at()).is_err());
    }
}
