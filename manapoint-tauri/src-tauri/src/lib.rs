//! Tauri wiring: window chrome, tray, drag-to-snap, and the polling loop.
//!
//! Everything the frontend can reach goes through the commands below; the shapes are
//! frozen in CONTRACT.md. Domain logic lives in the sibling modules and stays UI-free.

mod autostart;
mod cache;
mod error;
mod model;
mod paths;
mod providers;
mod settings;
mod snap;
mod win;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WebviewWindowBuilder};

use crate::model::{ProviderUsage, UsageWindow};
use crate::providers::{Badge, ProviderDescriptor};
use crate::settings::{AppSettings, CardLayout};

const PANEL: &str = "panel";
const SETTINGS: &str = "settings";
const TRAY: &str = "tray";

/// The panel refreshes on this cadence. Matches the xAI token skew, so a token that
/// expires between polls is renewed before the next request goes out.
const REFRESH_INTERVAL: Duration = Duration::from_secs(300);

/// One provider's row on the panel. See CONTRACT.md §1.4.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardState {
    id: String,
    name: String,
    badge: Badge,
    windows: Vec<UsageWindow>,
    note: Option<String>,
    error: Option<String>,
}

impl CardState {
    fn blank(d: &ProviderDescriptor) -> Self {
        Self {
            id: d.id.to_string(),
            name: d.name.to_string(),
            badge: d.badge.clone(),
            windows: Vec::new(),
            note: None,
            error: None,
        }
    }
}

/// Initial payload for either window. See CONTRACT.md §2.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialState {
    settings: AppSettings,
    providers: Vec<ProviderDescriptor>,
    auto_start: bool,
    auto_start_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStartResult {
    enabled: bool,
    error: Option<String>,
}

struct AppState {
    http: reqwest::Client,
    settings: Mutex<AppSettings>,
    cards: Mutex<Vec<CardState>>,
    /// Last successful reading per provider. A transient failure keeps showing these
    /// with a note instead of blanking the panel to red.
    last_good: Mutex<HashMap<String, ProviderUsage>>,
}

impl AppState {
    fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("building an HTTP client with only a timeout cannot fail");

        Self {
            http,
            settings: Mutex::new(settings::load()),
            cards: Mutex::new(Vec::new()),
            last_good: Mutex::new(cache::load()),
        }
    }

    fn settings(&self) -> AppSettings {
        self.settings.lock().expect("settings mutex poisoned").clone()
    }

    /// Mutate, persist, and hand the result to both windows in one step — the settings
    /// window and the panel must never disagree about what is stored.
    fn update_settings<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        edit: impl FnOnce(&mut AppSettings),
    ) -> AppSettings {
        let updated = {
            let mut guard = self.settings.lock().expect("settings mutex poisoned");
            edit(&mut guard);
            *guard = guard.clone().clamped();
            guard.clone()
        };
        settings::save(&updated);
        let _ = app.emit("settings", &updated);
        updated
    }
}

/// Providers the user has ticked, in the order they arranged them.
fn enabled_descriptors(s: &AppSettings) -> Vec<ProviderDescriptor> {
    let enabled = s
        .enabled_providers
        .clone()
        .unwrap_or_else(providers::default_enabled);

    providers::in_order(s.provider_order.as_deref())
        .into_iter()
        .filter(|d| enabled.iter().any(|id| id == d.id))
        .collect()
}

/// Fill the panel from the on-disk snapshot so a cold start shows numbers immediately
/// instead of a column of errors while the first requests are in flight.
fn seed_from_cache(state: &AppState) -> Vec<CardState> {
    let descriptors = enabled_descriptors(&state.settings());
    let cached = state.last_good.lock().expect("cache mutex poisoned").clone();

    descriptors
        .iter()
        .map(|d| {
            let mut card = CardState::blank(d);
            if let Some(usage) = cached.get(d.id) {
                card.windows = usage.windows.clone();
                card.note = Some("上次數字，更新中".to_string());
            }
            card
        })
        .collect()
}

async fn collect_all(state: &AppState) -> Vec<CardState> {
    let descriptors = enabled_descriptors(&state.settings());

    // Fire all providers at once: four sequential round trips would make a cold start
    // visibly slower for no reason. Each is independent.
    let mut pending = Vec::with_capacity(descriptors.len());
    for d in &descriptors {
        let http = state.http.clone();
        let id = d.id;
        pending.push(tauri::async_runtime::spawn(async move {
            (id, providers::collect(id, &http).await)
        }));
    }

    let mut results = HashMap::new();
    for handle in pending {
        if let Ok((id, outcome)) = handle.await {
            results.insert(id, outcome);
        }
    }

    let mut last_good = state.last_good.lock().expect("cache mutex poisoned");
    let cards: Vec<CardState> = descriptors
        .iter()
        .map(|d| {
            let mut card = CardState::blank(d);
            match results.remove(d.id) {
                Some(Ok(usage)) => {
                    card.windows = usage.windows.clone();
                    card.note = usage.note.clone();
                    last_good.insert(d.id.to_string(), usage);
                }
                // A stale reading with an explanation beats an empty card: the CLI
                // usually re-authenticates itself and the next poll recovers.
                Some(Err(e)) if e.keeps_last_good() => match last_good.get(d.id) {
                    Some(previous) => {
                        card.windows = previous.windows.clone();
                        card.note = Some(e.message().to_string());
                    }
                    None => card.error = Some(e.message().to_string()),
                },
                Some(Err(e)) => card.error = Some(e.message().to_string()),
                None => card.error = Some("取數任務中斷".to_string()),
            }
            card
        })
        .collect();

    cache::save(&last_good);
    drop(last_good);

    *state.cards.lock().expect("cards mutex poisoned") = cards.clone();
    cards
}

// ── commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> InitialState {
    let s = state.settings();
    InitialState {
        providers: providers::in_order(s.provider_order.as_deref()),
        settings: s,
        auto_start: autostart::is_enabled(),
        auto_start_supported: autostart::is_supported(),
    }
}

#[tauri::command]
fn get_cards(state: State<'_, AppState>) -> Vec<CardState> {
    let cards = state.cards.lock().expect("cards mutex poisoned").clone();
    if cards.is_empty() {
        return seed_from_cache(&state);
    }
    cards
}

#[tauri::command]
async fn refresh(state: State<'_, AppState>) -> Result<Vec<CardState>, ()> {
    Ok(collect_all(&state).await)
}

#[tauri::command]
fn set_theme(app: AppHandle, state: State<'_, AppState>, name: String) -> AppSettings {
    state.update_settings(&app, |s| s.theme_name = name)
}

#[tauri::command]
fn set_opacity(app: AppHandle, state: State<'_, AppState>, value: f64) -> AppSettings {
    state.update_settings(&app, |s| s.panel_opacity = value)
}

#[tauri::command]
fn set_layout(app: AppHandle, state: State<'_, AppState>, layout: CardLayout) -> AppSettings {
    state.update_settings(&app, |s| s.cards_layout = layout)
}

#[tauri::command]
fn set_provider_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppSettings {
    let updated = state.update_settings(&app, |s| {
        let mut ids = s
            .enabled_providers
            .clone()
            .unwrap_or_else(providers::default_enabled);
        ids.retain(|existing| existing != &id);
        if enabled {
            ids.push(id.clone());
        }
        s.enabled_providers = Some(ids);
    });

    // Redraw at once from what is already known, then fetch only if a provider was
    // switched on and has no numbers yet.
    let needs_data = restack_cards(&app, &updated);
    if enabled && needs_data {
        kick_refresh(&app);
    }
    updated
}

#[tauri::command]
fn set_provider_order(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>) -> AppSettings {
    let updated = state.update_settings(&app, |s| s.provider_order = Some(ids));
    // Reordering is presentation only. Re-fetching would cost a round trip per provider
    // (and risk a rate limit) to show the very same numbers in a different order, which
    // reads as the drag having done nothing.
    restack_cards(&app, &updated);
    updated
}

/// Rebuild the card list for the current selection and order, reusing readings already
/// in hand. Returns true if some card has no data yet and a fetch is worth doing.
fn restack_cards(app: &AppHandle, settings: &AppSettings) -> bool {
    let state = app.state::<AppState>();
    let wanted = enabled_descriptors(settings);

    let mut cards = state.cards.lock().expect("cards mutex poisoned");
    let known: HashMap<String, CardState> =
        cards.drain(..).map(|c| (c.id.clone(), c)).collect();
    let last_good = state.last_good.lock().expect("cache mutex poisoned");

    let mut incomplete = false;
    *cards = wanted
        .iter()
        .map(|d| match known.get(d.id) {
            Some(existing) => existing.clone(),
            None => {
                let mut card = CardState::blank(d);
                match last_good.get(d.id) {
                    Some(usage) => {
                        card.windows = usage.windows.clone();
                        card.note = Some("上次數字，更新中".to_string());
                    }
                    None => incomplete = true,
                }
                card
            }
        })
        .collect();

    let _ = app.emit("cards", cards.clone());
    incomplete
}

#[tauri::command]
fn set_auto_start(enabled: bool) -> AutoStartResult {
    match autostart::set_enabled(enabled) {
        // Report what the registry actually says, not what was asked for.
        Ok(()) => AutoStartResult { enabled: autostart::is_enabled(), error: None },
        Err(e) => AutoStartResult { enabled: autostart::is_enabled(), error: Some(e) },
    }
}

/// Hand the move to the OS: a window dragged by the compositor tracks the cursor
/// perfectly, whereas repositioning it per pointer event is laggy and jittery.
///
/// Edge snapping happens *during* the drag, not on release — see
/// [`win::install_drag_snap`], which rewrites the rectangle the OS proposes as it
/// moves the window, so the panel visibly grips the edge while the user is still
/// holding it.
#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

fn window_work_area<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<snap::WorkArea> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().ok()?;
        win::work_area(hwnd.0 as isize)
    }
    #[cfg(not(windows))]
    {
        // Other platforms have no work-area query here yet; fall back to the full
        // monitor so snapping still lands on screen edges.
        let monitor = window.current_monitor().ok()??;
        let p = monitor.position();
        let s = monitor.size();
        Some(snap::WorkArea {
            left: p.x,
            top: p.y,
            right: p.x + s.width as i32,
            bottom: p.y + s.height as i32,
        })
    }
}

/// The panel has no fixed height: the frontend measures its rendered content and calls
/// this. Growing content must not push a bottom-anchored panel off the screen, so any
/// edge the window was already flush against is preserved.
#[tauri::command]
fn resize_panel(window: WebviewWindow, width: f64, height: f64) {
    let Ok(before) = window.outer_size() else { return };
    if window
        .set_size(tauri::LogicalSize::new(width.max(1.0), height.max(1.0)))
        .is_err()
    {
        return;
    }

    let (Ok(after), Ok(pos)) = (window.outer_size(), window.outer_position()) else {
        return;
    };
    let Some(area) = window_work_area(&window) else { return };

    let kept = snap::keep_edges(
        (pos.x, pos.y),
        (before.width as i32, before.height as i32),
        (after.width as i32, after.height as i32),
        area,
    );
    if kept != (pos.x, pos.y) {
        let _ = window.set_position(tauri::PhysicalPosition::new(kept.0, kept.1));
    }
}

/// A native menu rather than an HTML one: the panel window is only a couple of hundred
/// pixels tall, so an in-page menu would be clipped by the window bounds.
#[tauri::command]
fn show_panel_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let menu = panel_menu(&app).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_panel(app: AppHandle) {
    let Some(window) = app.get_webview_window(PANEL) else { return };

    // Show both ways home only while hidden; a permanent tray icon and taskbar button
    // would occupy two slots for a widget that normally sits on the desktop.
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_visible(true);
    }
    let _ = window.set_skip_taskbar(false);
    let _ = window.minimize();
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SETTINGS) {
        let _ = existing.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, SETTINGS, tauri::WebviewUrl::App("settings.html".into()))
        .title("Manapoint 設定")
        .inner_size(420.0, 640.0)
        .resizable(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── menus, tray, lifecycle ───────────────────────────────────────────────────

fn panel_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "refresh", "重新整理", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "minimize", "最小化", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "設定…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?,
        ],
    )
}

fn tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "show", "顯示面板", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "設定…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?,
        ],
    )
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "refresh" => kick_refresh(app),
        "minimize" => minimize_panel(app.clone()),
        "settings" => {
            show_panel(app);
            let _ = open_settings(app.clone());
        }
        "show" => show_panel(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn show_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window(PANEL) else { return };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Re-poll off the UI thread and push the result to whichever windows are open.
fn kick_refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let cards = collect_all(&app.state::<AppState>()).await;
        let _ = app.emit("cards", cards);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Minimising hides the panel, so a second launch looks like nothing happened
        // and users click again. Surface the existing one instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_panel(app);
        }))
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_cards,
            refresh,
            set_theme,
            set_opacity,
            set_layout,
            set_provider_enabled,
            set_provider_order,
            set_auto_start,
            start_drag,
            resize_panel,
            show_panel_menu,
            minimize_panel,
            open_settings,
        ])
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();

            let tray = TrayIconBuilder::with_id(TRAY)
                .icon(app.default_window_icon().cloned().expect("bundled icon"))
                .tooltip("Manapoint")
                .menu(&tray_menu(&handle)?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        show_panel(tray.app_handle());
                    }
                })
                .build(app)?;
            // Hidden until the panel is minimised; see minimize_panel.
            tray.set_visible(false)?;

            // Snapping is done by the OS drag loop itself, so it has to be wired to the
            // window handle rather than to any Tauri event.
            #[cfg(windows)]
            if let Some(panel) = app.get_webview_window(PANEL) {
                if let Ok(hwnd) = panel.hwnd() {
                    win::install_drag_snap(hwnd.0 as isize);
                }
            }

            {
                let state = handle.state::<AppState>();
                *state.cards.lock().expect("cards mutex poisoned") = seed_from_cache(&state);
            }

            let poller = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let cards = collect_all(&poller.state::<AppState>()).await;
                    let _ = poller.emit("cards", cards);
                    tokio::time::sleep(REFRESH_INTERVAL).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Coming back from the tray or taskbar: stop occupying either again.
            if let tauri::WindowEvent::Focused(true) = event {
                if window.label() != PANEL {
                    return;
                }
                let app = window.app_handle();
                if let Some(tray) = app.tray_by_id(TRAY) {
                    let _ = tray.set_visible(false);
                }
                let _ = window.set_skip_taskbar(true);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
