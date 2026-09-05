//! Snapshot of the last successful reading (%APPDATA%\Manapoint\usage-snapshot.json).
//! A cold start or a rate limit shows the old numbers instead of a column of red.
//! It holds only percentages and reset times — never a credential.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::model::ProviderUsage;
use crate::paths;

pub type Snapshot = HashMap<String, ProviderUsage>;

pub fn file_path() -> PathBuf {
    paths::app_data_dir().join("usage-snapshot.json")
}

/// Missing or corrupt file reads as empty — a lost cache is not worth failing over.
pub fn load() -> Snapshot {
    std::fs::read_to_string(file_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write failures are swallowed; the next successful poll writes again.
pub fn save(snapshot: &Snapshot) {
    let path = file_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(snapshot) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{UsageWindow, UsageWindowKind};
    use chrono::{TimeZone, Utc};

    #[test]
    fn round_trips_through_json() {
        let mut snapshot = Snapshot::new();
        snapshot.insert(
            "opencode-go".into(),
            ProviderUsage::new(
                "opencode Go",
                vec![UsageWindow::new(
                    UsageWindowKind::Weekly,
                    42.5,
                    Some(Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap()),
                )],
                Utc.with_ymd_and_hms(2026, 9, 6, 8, 0, 0).unwrap(),
            ),
        );

        let json = serde_json::to_string(&snapshot).unwrap();
        let back: Snapshot = serde_json::from_str(&json).unwrap();

        assert_eq!(snapshot, back);
    }

    /// A corrupt cache must read as "nothing cached", never stop the app starting.
    #[test]
    fn treats_corrupt_json_as_empty() {
        assert!(serde_json::from_str::<Snapshot>("{ not json").is_err());
    }
}
