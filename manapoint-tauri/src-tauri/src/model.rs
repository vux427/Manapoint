use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Which reset window a reading belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UsageWindowKind {
    /// Short rolling window; five hours on most plans.
    Rolling,
    Weekly,
    Monthly,
}

/// How much of one window is used, and when it resets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub kind: UsageWindowKind,
    /// Percentage used, 0-100.
    pub percent: f64,
    /// None when the provider does not report one.
    #[serde(default)]
    pub resets_at: Option<DateTime<Utc>>,
}

impl UsageWindow {
    pub fn new(kind: UsageWindowKind, percent: f64, resets_at: Option<DateTime<Utc>>) -> Self {
        Self { kind, percent, resets_at }
    }
}

/// One provider's windows at a point in time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider: String,
    pub windows: Vec<UsageWindow>,
    pub collected_at: DateTime<Utc>,
    /// Why there is nothing to draw — an account with no quota cap, for instance.
    /// This is not a failure, which is why it is separate from the card's error.
    #[serde(default)]
    pub note: Option<String>,
}

impl ProviderUsage {
    pub fn new(provider: &str, windows: Vec<UsageWindow>, collected_at: DateTime<Utc>) -> Self {
        Self { provider: provider.to_string(), windows, collected_at, note: None }
    }

    pub fn with_note(provider: &str, collected_at: DateTime<Utc>, note: String) -> Self {
        Self { provider: provider.to_string(), windows: Vec::new(), collected_at, note: Some(note) }
    }
}
