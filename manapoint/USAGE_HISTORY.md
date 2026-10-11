# Usage history

This feature extends the existing frontend/backend contract without changing the
panel's card format or the projection history.

- `AppSettings.historyIntervalMinutes`: integer minutes, 1–1440, defaults to 5.
- `set_history_interval({ minutes })`: validates and persists the interval, resets
  the recording timer, returns `AppSettings`, and pushes the `settings` event.
- `get_usage_history()`: returns chronological samples from the last seven days.
- `usage_history` event: `{ timestamp }`, pushed after a successful archive write.
- Each sample is `{ timestamp, cards }`; `timestamp` is Unix milliseconds and each
  card contains `id`, `name`, `note`, `error`, and usage `windows`. Windows contain
  `kind`, used `percent`, `resetsAt`, and optional `account`. The history page
  displays remaining percentage as `100 - percent`.

The archive is `%APPDATA%/Manapoint/usage-history.json`, with the same fallback
directory as settings. Writes use a temporary file and rename, keeping the prior
archive intact if a write fails. Pruning and recording are serialized.

The app refreshes and records enabled services on launch and after each configured
interval. A simultaneous refresh joins the current provider collection. Recording
does not depend on which windows are hidden in the panel. Cached readings retain
their notes, and failed services retain their error state rather than becoming zero
remaining quota. Tokens, credentials, and projections are excluded.

Expired samples are removed when recording or querying the archive. On launch,
expired persisted samples are excluded before the first new archive write. The app
must be running to record; missed intervals while closed or suspended are not
backfilled. The timer waits the configured interval after each recording finishes.

Both panel and tray menus open the singleton `history.html` window. It offers
provider and time filters, newest-first ordering, 100 window rows per page, local
timestamps, and updates after recordings. Provider filtering includes historical
services even if they have since been disabled.

Validation: `node --test manapoint/test/*.test.mjs` from the repository root.
The integration test uses a simulated txiki filesystem, clock, timers, and fixture
cards to verify startup, interval rescheduling, persisted reload, retention,
hidden windows, failed writes, and recovery.

Native tinyjs v0.50.1 on Linux was also checked with isolated fixture data:
the settings window persisted an interval change, and the history window rendered
all 12 multi-account windows with remaining percentages and working provider
filtering. The Windows release uses the official Windows tinyjs toolchain under
Wine; native Windows WebView2 interaction still requires a Windows host.
The actual Windows txiki runtime also passed fixture checks for launch recording,
all 12 windows, interval persistence, atomic file overwrite, and restoring the
archive and settings after restart.
