# Cursor subscription usage

Implemented against repository revision `e0bad28`, pulled before making changes.

## Behavior

- Registers `cursor` in the provider registry, so the panel, settings, alerts,
  history, local API and headless collector share the existing integration.
- Discovers `accessToken` in current and legacy Cursor CLI files, including XDG
  and `CURSOR_ACP_HOME_DIR` paths, and reads the desktop app's token from
  `state.vscdb` with a read-only SQLite connection.
- Queries `GET https://cursor.com/api/usage-summary` with a session derived from
  the local access JWT. No model generation request is made.
- Shows the monthly total percentage, falling back to used/limit amounts.
  Independent Auto/API percentages stay separate when no total is supplied.
  Enterprise personal caps and shared team pools are supported; shared pools
  are explicitly labelled.
- Uses the reported billing reset and preserves valid percentages when the
  optional reset is unavailable. Missing amounts never become invented zeros.
- Discovers all login sources, deduplicates matching tokens/accounts and keeps
  distinct accounts separate. A failing source cannot suppress another success.
- Re-reads logins each poll and retries once when a rejected token has rotated.
  Login failures and rate limits preserve the last successful reading.
- Adds the Cursor mark to the panel, iCUE and Herdr, plus settings entries in
  both companion interfaces. Existing explicit provider selections are respected.
- Retains percentages/reset times only. Tokens, account metadata and raw API
  responses are excluded from snapshots, history, local feeds and error details.

## Evidence

The requested [opencode-cursor repository](https://github.com/Nomadcxx/opencode-cursor)
documents CLI credential discovery in `src/auth.ts`. Its `src/usage.ts` translates
per-generation token counts and costs; it does not query subscription quota.

The dashboard endpoint, response fields and local-session construction were
cross-checked with [CodexBar's Cursor provider](https://github.com/steipete/CodexBar/tree/main/Sources/CodexBarCore/Providers/Cursor),
particularly `CursorAppAuth.swift`, `CursorStatusProbe.swift` and
`CursorStatusProbe+UsageSummary.swift`. This is an independent implementation.
The Cursor vector mark comes from Simple Icons (CC0).

## Validation

- `node --test test/*.test.mjs`: 247 tests passed, including 19 Cursor tests.
- Syntax checks passed for all 13 changed/new JavaScript modules.
- Chromium/Playwright: 30 panel scenarios across all five themes and both
  layouts, covering total usage, separate pools and note-only responses.
- Browser checks also verified the Cursor settings checkbox, iCUE icon and
  monthly visibility switch. No browser errors or panel overflow were observed.
- iCUE property metadata remains XML-well-formed; `git diff --check` passed.

## Remaining platform verification

Live subscription requests were not exercised. Local tests used synthetic
credentials and reference-shaped replies. The v0.4.15 release workflow builds
the Windows GUI and standalone CLI and smoke-tests the compiled collector against
an isolated empty profile before packaging and publishing.
Encrypted `cursor-safe-storage:` tokens require a CLI file login; browser-cookie
import and OS decryption are not implemented. Legacy request-count plans and
weekly pools from other dashboard endpoints are outside this monthly collector.

Herdr's loopback mode can consume the new provider from an updated Manapoint.
Release packages replace the checked-in collector with the freshly built CLI.
Remote installs use the latest release with SHA-256 verification. A local source
installation must first rebuild and copy the CLI as documented in `herdr-mod/README.md`.
See `docs/providers.md` for the complete credential and parsing rules.
