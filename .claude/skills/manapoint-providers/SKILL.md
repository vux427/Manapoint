---
name: manapoint-providers
description: How Manapoint's usage collectors work and how to add, fix or debug one — error kinds and what they do to a card, OAuth refresh/write-back rules per CLI, multi-account discovery and rendering, the snapshot cache, the safe diagnostics script, fixture mode for screenshots, and the test layout. Use when a card shows the wrong thing, when a vendor changes an endpoint or credential shape, when adding a provider or an account source, or when touching manapoint/src/providers or manapoint/src/lib.
---

# Manapoint collectors

Code: `manapoint/src/providers/*.js` (one collector + one `*_token.js` per OAuth
login), shared rules in `manapoint/src/lib/`. Endpoint and credential facts per
vendor live in `docs/providers.md` — update it with every shape change. The
page-facing shapes are frozen in `manapoint/CONTRACT.md` §1–2.

## A collector's contract

`collect()` → `usage(provider, windows, collectedAt, note?)` or throws a
`CollectError`. Windows: `{ kind: 'Rolling'|'Weekly'|'Monthly', percent 0-100,
resetsAt: RFC 3339 | null, account? }`.

| outcome | card shows | snapshot |
|---|---|---|
| windows | the bars (+ note) | replaced |
| note only (`windows: []`) | the note — a fact, not a failure ("no Go plan") | **kept** (never wipe real numbers with a note) |
| `notReady(msg)` | last numbers + msg as note; msg as error if none cached | kept |
| `transient(msg)` | same as NotReady | kept |
| `failed(msg)` | error, bars cleared | kept |

Rules that keep the panel honest:
- Missing/renamed field → `failed`, never a fabricated 0%. Optional things
  (a reset time, a second window) are skipped, not invented.
- `notReady` messages are shown verbatim: make them an instruction
  ("請在 opencode 重新登入 xAI"), in Traditional Chinese.
- 401/403 on the usage call → refresh once and retry before telling the
  user to log in.
- Error kinds are checked by duck typing (`asCollectError`): txiki can load
  `errors.js` twice under different path spellings, so `instanceof` lies and
  would silently turn NotReady into Failed. 429 → transient. Other statuses → `statusError(status,
  body)` (the body goes to `err.detail`, which diagnostics print).
- Parse by `bucketId`/key, never by position; classify windows by length
  (Codex), not field order.

## Token handling (per CLI)

| login | file | refresh | write back? |
|---|---|---|---|
| Claude Code | `~/.claude/.credentials.json` `claudeAiOauth` | form POST platform.claude.com | yes — only the 3 token fields |
| Codex | `~/.codex/auth.json` `tokens` + `last_refresh` | JSON POST auth.openai.com (honours `CODEX_*_OVERRIDE` env) | yes — only `tokens`/`last_refresh` |
| xAI (Grok) | opencode `auth.json` `xai` | form POST auth.x.ai | yes — only the `xai` node |
| Antigravity | keyring `gemini:antigravity`, opencode 'google', plugin file | Google installed-app flow (one public client for all three) | **never** — mint in memory, keyed by refresh token |
| xAI via opencode | opencode.db 'xai' rows (auth.json `xai` legacy) | form POST auth.x.ai | yes — merge into the row's value |
| Claude/Codex via opencode | 'anthropic' / 'openai' rows or auth.json nodes | the vendor's own flow (same public client) | yes — `freshToken` |
| opencode console | opencode.db 'opencode' row | JSON POST {server}/auth/device/token, client `opencode-cli` | yes |
| opencode Go/Zen keys | auth.json keys, plugin file | none (API keys) | never |

Write-back discipline: re-read the file right before writing, merge only
your fields (unknown siblings survive), write `tmp` then rename. After a failed
refresh, re-read: if the CLI rotated first, use the winner's token. A local
expiry is a hint, not a verdict — proactive refresh 5 min early, but an
expired-looking token still gets one attempt.

## Routes and multiple accounts

Every provider collects through `collectRoutes(provider, routes, missingMsg)`
(`lib/accounts.js`). A route = `{ label, identity?, run }`; a reading may also
carry `identity` (stripped before caching). The rule, as the user specified it:
try **every** route at once in priority order; any route with data wins and the
failed ones are ignored; only when **all** fail does the card fail (with the
first route's reason). Successful routes into the same account merge — by
identity when both know one (Codex account id), else by an identical
percent+reset fingerprint. Note-only readings ("no Go plan") yield to any route
with numbers. One distinct account → a plain reading (no `account` tag);
several → windows tagged `account`, one `li.meter-group` per account (compact:
one row each).

Where logins live (verified 2026-09-26 against current opencode):
- **opencode.db** `credential` table is the live store — `integration_id`
  ('opencode', 'xai', 'google', 'anthropic', 'openai'…), `label`, `value` JSON
  (`{type:'oauth', access, refresh, expires, metadata?}` | `{type:'key', key}`),
  `active`. auth.json is legacy and goes stale. Read with `tjs:sqlite`
  read-only; write refreshed tokens back with `BEGIN IMMEDIATE` and a merge of
  the row's value (`lib/opencode_db.js`). Vendor OAuth logins opencode holds:
  `lib/opencode_logins.js` (`opencodeLogins`, `freshToken` with write-back).
- **opencode console login** (integration 'opencode', device-code OAuth): its
  usage is NOT on /zen. `GET {server}/api/config` (Bearer access, `x-org-id`)
  → `provider["opencode-go"].api` = `…/inference/go/openai/v1` and
  `options.headers` (`x-opencode-org-id`); `options.apiKey` is only the template
  `{env:OPENCODE_CONSOLE_TOKEN}`, i.e. the access token. Usage =
  `GET …/inference/go/v1/usage` with that token and header.
- Plugins: `~/.config/opencode/opencode-go-accounts.json` (go-multi-auth),
  `%APPDATA%\opencode\antigravity-accounts.json` (antigravity-multi-auth).
- Anthropic refuses any request carrying an `Origin` header for orgs that
  disallow CORS (401, even with `anthropic-dangerous-direct-browser-access`).
  txiki's fetch always adds Origin, so every Anthropic call uses
  `requestNoOrigin` (system curl; see the tinyjs-windows skill). `request()` also
  retries once through curl on a network-level failure.

## Debugging a red card

1. Never read the user's credential files or keyring yourself. Ask them to run
   (from `manapoint/`): `%LOCALAPPDATA%\tinyjs\bin\tjs.exe run diagnose.js` —
   it prints file existence, field NAMES/types/lengths, expiry times, each
   provider's result or error and the error body; no secret values.
2. Check the wire with fake values against `https://httpbin.org/anything`
   before blaming a vendor (txiki's fetch adds `Origin`, `Cache-Control`,
   `Pragma`).
3. Probe a vendor with a FAKE token to learn its error shape (e.g. Anthropic
   answers `authentication_error` "Invalid bearer token" either way).

## Layout / screenshots without real accounts

`MANAPOINT_FIXTURE=<abs path to CardState[] json> tinyjs dev` serves those
cards and never polls. Sample: `manapoint/test/fixtures/multi-account.json`.
Screenshot recipe: see the tinyjs-windows skill.

## Tests

`cd manapoint && node --test test/*.test.mjs` — providers (real-response
fixtures), tokens (skew, rotation, merge-preserves-siblings), accounts, core
(settings, order, cards, snapping), plus the UI suites (themes contrast,
format, settings). Every parser and rule is pure so Node runs it; IO lives only
in `lib/io.js` / `lib/keyring.js`. Port a Rust-era test when you touch its
area rather than deleting it.
