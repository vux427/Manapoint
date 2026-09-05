use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::paths;

/// Slider floor. Between this and the safe floor (0.80, enforced by the frontend's
/// contrast test) the user is on their own — legibility is not guaranteed there.
pub const MIN_OPACITY: f64 = 0.30;

pub const MAX_OPACITY: f64 = 1.0;

/// Card arrangement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardLayout {
    Vertical,
    Horizontal,
}

/// Persisted user preferences.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme_name: String,
    pub cards_layout: CardLayout,
    /// Panel background opacity, 0.30-1.0.
    pub panel_opacity: f64,
    /// Provider ids to show. None means "never configured", so defaults apply.
    #[serde(default)]
    pub enabled_providers: Option<Vec<String>>,
    /// Display order, including unticked providers. None means registry order.
    #[serde(default)]
    pub provider_order: Option<Vec<String>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme_name: "石墨".into(),
            cards_layout: CardLayout::Vertical,
            panel_opacity: 0.85,
            enabled_providers: None,
            provider_order: None,
        }
    }
}

impl AppSettings {
    /// Older files may hold values outside the current range; pull them back on load so
    /// the panel and the file cannot drift apart indefinitely.
    pub fn clamped(mut self) -> Self {
        self.panel_opacity = self.panel_opacity.clamp(MIN_OPACITY, MAX_OPACITY);
        self
    }
}

pub fn file_path() -> PathBuf {
    paths::app_data_dir().join("settings.json")
}

/// Missing or corrupt file falls back to defaults — losing preferences is not worth
/// refusing to start over.
pub fn load() -> AppSettings {
    let Ok(text) = std::fs::read_to_string(file_path()) else {
        return AppSettings::default();
    };
    serde_json::from_str::<AppSettings>(&text)
        .unwrap_or_default()
        .clamped()
}

/// Write failures are swallowed; the next change tries again.
pub fn save(settings: &AppSettings) {
    let path = file_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_opacity_from_older_files() {
        let low = AppSettings { panel_opacity: 0.05, ..Default::default() }.clamped();
        assert_eq!(MIN_OPACITY, low.panel_opacity);

        let high = AppSettings { panel_opacity: 2.0, ..Default::default() }.clamped();
        assert_eq!(MAX_OPACITY, high.panel_opacity);
    }

    #[test]
    fn defaults_to_vertical_cards() {
        assert_eq!(CardLayout::Vertical, AppSettings::default().cards_layout);
    }

    /// Round-tripping matters: the settings window and the panel both read this file.
    #[test]
    fn round_trips_through_json() {
        let original = AppSettings {
            theme_name: "魔力".into(),
            cards_layout: CardLayout::Horizontal,
            panel_opacity: 0.7,
            enabled_providers: Some(vec!["codex".into()]),
            provider_order: Some(vec!["codex".into(), "grok".into()]),
        };

        let json = serde_json::to_string(&original).unwrap();
        assert_eq!(original, serde_json::from_str(&json).unwrap());
        assert!(json.contains("cardsLayout"), "must serialise camelCase for the frontend");
    }
}
