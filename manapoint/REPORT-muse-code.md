# Muse Code usage support

Added the `muse-code` provider for Meta Muse Code. It reads the CLI's file-backed device login and calls `POST https://api.meta.ai/muse-code/key` with an empty JSON object to display five-hour and weekly used percentages and reset countdowns. The provider appears in settings and uses the existing panel, tray, alerts, history, and loopback feed. Existing explicitly selected providers are respected; select Muse Code in settings to enable it in that case.

Credential paths honor `MUSE_AUTH_PATH`, then `XDG_CONFIG_HOME`, then the CLI's `~/.config/muse/auth.json`. Only a nonempty printable device token beginning with `dca:` is accepted. No credentials are written. Inference keys, account metadata, payment details, and raw response bodies are excluded from readings and diagnostics.

Inactive subscriptions and incomplete billing produce explanatory notes. An active subscription whose response omits `subs_usage` produces an unavailable-quota note instead of invented zero usage. Invalid quota shapes fail explicitly. Login rejection and rate limits preserve the last successful reading through the existing card policy. A subsequent CLI login is picked up on the next poll.

Updated provider documentation, both READMEs, safe file diagnostics, the provider ID contract entry, and the registry ordering expectation. No new dependencies were added.

Validation: `node --test test/*.test.mjs` passed all 202 tests, including 17 new Muse cases. Coverage includes parsing, malformed and missing quota, reset dates, device-token validation, path precedence, request construction, CLI token changes, authentication/rate-limit behavior, secret exclusion, saved enablement, and the loopback payload. Changed JavaScript files pass `node --check`; `git diff --check` passes.

Limitations: this Linux environment has no Windows tinyjs toolchain and no real Meta subscription login, so a Windows executable build and live subscription verification were not performed. The response schema was checked against [CodexBar's Muse provider](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/muse.ts); Windows file credentials were confirmed against [Meta SDK issue #38](https://github.com/meta-models/muse-code-sdk/issues/38). macOS Keychain and browser team quota are outside this implementation. Meta can omit all quota while the five-hour window is idle even when weekly usage exists; this implementation reports that condition explicitly.
