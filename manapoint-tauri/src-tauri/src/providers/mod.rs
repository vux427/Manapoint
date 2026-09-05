//! Every supported provider. Adding one means registering it here.

pub mod claude;
pub mod codex;
pub mod grok;
pub mod opencode_go;
pub mod xai_token;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::error::{CollectError, CollectResult};
use crate::model::ProviderUsage;

pub const OPENCODE_GO: &str = "opencode-go";
pub const CLAUDE_CODE: &str = "claude-code";
pub const CODEX: &str = "codex";
pub const GROK: &str = "grok";

/// The mark on the left of a card: the official glyph on the brand colour.
/// `icon` is a key into ui/icons.js, which is where the frontend gets the path data.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub icon: Option<&'static str>,
    pub text: Option<&'static str>,
    pub background: &'static str,
    pub foreground: &'static str,
}

/// One subscription the panel can read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub credential_hint: &'static str,
    pub badge: Badge,
}

const ON_DARK: &str = "#FFFFFF";
const ON_LIGHT: &str = "#16181C";

/// Three of the four brand colours are near-black and are told apart by glyph shape;
/// opencode gets a white ground so the row is not one solid black block.
pub fn all() -> Vec<ProviderDescriptor> {
    vec![
        ProviderDescriptor {
            id: OPENCODE_GO,
            name: "opencode Go",
            credential_hint: "opencode CLI 登入狀態",
            badge: Badge { icon: Some("OpenCode"), text: None, background: "#F2F2F2", foreground: ON_LIGHT },
        },
        ProviderDescriptor {
            id: CLAUDE_CODE,
            name: "Claude Code",
            credential_hint: "Claude Code 登入狀態",
            badge: Badge { icon: Some("Claude"), text: None, background: "#D97757", foreground: ON_DARK },
        },
        ProviderDescriptor {
            id: CODEX,
            name: "Codex",
            credential_hint: "Codex CLI 登入狀態",
            badge: Badge { icon: Some("OpenAI"), text: None, background: "#000000", foreground: ON_DARK },
        },
        ProviderDescriptor {
            id: GROK,
            name: "Grok",
            credential_hint: "opencode 的 xAI 登入",
            badge: Badge { icon: Some("Grok"), text: None, background: "#1A1A1A", foreground: ON_DARK },
        },
    ]
}

/// Everything is on until the user says otherwise.
pub fn default_enabled() -> Vec<String> {
    all().iter().map(|p| p.id.to_string()).collect()
}

/// All providers in the user's order. Anything the stored order does not mention (a
/// newly added provider) goes last; ids in the order that no longer exist are skipped.
pub fn in_order(order: Option<&[String]>) -> Vec<ProviderDescriptor> {
    let everything = all();
    let Some(order) = order else { return everything };

    let mut listed: Vec<ProviderDescriptor> = order
        .iter()
        .filter_map(|id| everything.iter().find(|p| p.id == id).cloned())
        .collect();

    let seen: Vec<&str> = listed.iter().map(|p| p.id).collect();
    listed.extend(everything.into_iter().filter(|p| !seen.contains(&p.id)));
    listed
}

/// Collect one provider. An unknown id should never reach this.
pub async fn collect(id: &str, http: &reqwest::Client) -> CollectResult<ProviderUsage> {
    match id {
        OPENCODE_GO => opencode_go::collect(http).await,
        CLAUDE_CODE => claude::collect(http).await,
        CODEX => codex::collect(http).await,
        GROK => grok::collect(http).await,
        other => Err(CollectError::failed(format!("{other} 的取數器尚未實作。"))),
    }
}

// ── shared parsing helpers ───────────────────────────────────────────────────
// Deliberately strict: a missing field is an error. Drawing a fabricated 0% bar would
// be worse than saying the shape changed.

pub fn object<'a>(root: &'a Value, key: &str, whose: &str) -> CollectResult<&'a Value> {
    match root.get(key) {
        Some(v) if !v.is_null() => Ok(v),
        _ => Err(CollectError::failed(format!("{whose} 回應缺少 '{key}'。"))),
    }
}

pub fn number(node: &Value, key: &str, whose: &str) -> CollectResult<f64> {
    node.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| CollectError::failed(format!("{whose} 回應的 '{key}' 不是數字。")))
}

pub fn integer(node: &Value, key: &str, whose: &str) -> CollectResult<i64> {
    node.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| CollectError::failed(format!("{whose} 回應的 '{key}' 不是整數。")))
}

/// ISO 8601 / RFC 3339 timestamp. A value without an offset is read as UTC.
pub fn parse_datetime(raw: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|naive| naive.and_utc())
}

/// Optional timestamp: absent or null is None, not a failure.
pub fn optional_datetime(node: &Value, key: &str) -> Option<DateTime<Utc>> {
    node.get(key)?.as_str().and_then(parse_datetime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_order_puts_unlisted_providers_last() {
        let order = vec!["grok".to_string(), "codex".to_string()];
        let ids: Vec<&str> = in_order(Some(&order)).iter().map(|p| p.id).collect();

        assert_eq!(vec!["grok", "codex", "opencode-go", "claude-code"], ids);
    }

    /// A settings file holding a since-removed id must not break the list.
    #[test]
    fn in_order_skips_unknown_ids() {
        let order = vec!["ghost".to_string(), "codex".to_string()];
        let ids: Vec<&str> = in_order(Some(&order)).iter().map(|p| p.id).collect();

        assert_eq!("codex", ids[0]);
        assert_eq!(4, ids.len());
    }

    #[test]
    fn parses_iso_timestamps() {
        let dt = parse_datetime("2026-09-09T12:00:00Z").unwrap();
        assert_eq!("2026-09-09 12:00:00 UTC", dt.to_string());

        assert!(parse_datetime("not a date").is_none());
    }
}
