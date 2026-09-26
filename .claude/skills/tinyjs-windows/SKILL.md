---
name: tinyjs-windows
description: Hard-won facts for building, running, debugging and shipping a tinyjs (txiki.js + WebView2) desktop app on Windows — window units and geometry, frameless/transparent tray-style widgets, live drag snapping, FFI into Win32 (Credential Manager), backend fetch quirks, module layout rules, dev/build/verification loops. Use when working on Manapoint's manapoint/ app, when porting a Tauri/Electron widget to tinyjs, or whenever a tinyjs app misbehaves on Windows.
---

# tinyjs on Windows — what actually holds

Verified on tinyjs 0.42.0 (txiki.js 26.6.0), Windows 11, while porting Manapoint
from Tauri 2. The upstream reference ships with the install:
`%LOCALAPPDATA%\tinyjs\skill\SKILL.md` + `references/*.md` (api, platforms,
recipes, release) — read those for API surface; this file is the delta that
cost real debugging.

## Toolchain

- CLI: `%LOCALAPPDATA%\tinyjs\tinyjs.cmd` (cmd/PowerShell) or the sh wrapper
  `%LOCALAPPDATA%/tinyjs/tinyjs` (Git Bash). Runtime: `…\tinyjs\bin\tjs.exe`.
- `tinyjs dev` — run with reload. `TINYJS_DEBUG=1` traces every bridge line
  (`<<` from launcher, `>>` to launcher) — the fastest way to see what the page
  called, what the backend answered, and window state (`GOT n win {…}`).
- `tinyjs build` → portable `dist/<name>.exe` (compiled backend, frontend and
  icon bundled inside) + `dist/launcher.exe` (the WebView2 window). Ship BOTH;
  zip the folder. Manapoint: 5.75 MB + 0.94 MB = ~6.7 MB.
- Built exes carry **no version resource** (CompanyName etc. empty) and there
  is no manifest key for it — don't write release checks that demand one.
- Authenticode on the compiled backend exe is unverified: txiki appends the app
  bundle after the PE image and reads it from the end of the file. Sign
  `launcher.exe` only unless you have tested a signed backend.

## Running from an agent shell

- **`run_in_background` launches fail**: `launcher: failed to create webview`.
  Run in the foreground with a timeout, or background it inside one command
  and do your checks in the same command:
  `(TINYJS_DEBUG=1 timeout 20 tinyjs dev > log 2>&1 &); sleep 9; <screenshot>; sleep 12`
- A built GUI exe detaches from `timeout`; stop it with `taskkill //PID <pid> //F`
  (only PIDs you started).
- Screenshot just the app, not the user's desktop: enumerate visible top-level
  windows of process `launcher-win` (dev) / `launcher` (built) with
  `EnumWindows` + `GetWindowRect` (call `SetProcessDPIAware` first) and
  `Graphics.CopyFromScreen` that rect. Then `Read` the png.
- Isolate test runs from the user's real app data by overriding the env for
  the dev process only, e.g. `APPDATA=<scratch>\appdata tinyjs dev` with a
  hand-written settings file there — never edit the user's own settings to
  get a screenshot.
- **Locked screen / display off**: `CopyFromScreen` returns the lock-screen
  picture, not your window. Capture with `PrintWindow(hwnd, hdc, 2)`
  (PW_RENDERFULLCONTENT) instead — it renders the WebView2 content regardless.
- A module can be instantiated twice when imported via different relative
  spellings; never rely on `instanceof` for your own error classes across
  modules — check a `kind` field instead. The same goes for module-level
  mutable state set from `main.js` (e.g. a `setSpawner(app.spawnHidden)`
  hook): `./lib/io.js` and `../lib/io.js` are separate instances, so the
  setting silently misses the copy providers use. Keep such hooks on
  `globalThis[Symbol.for('app.key')]`.
- Shell heredocs can mangle backslashes in JS written through them (regexes
  like `/\\/g`, `﻿` escapes). Write such code with the Edit/Write tools, or
  avoid the escapes (`String.fromCharCode(92)`, `.split(x).join(y)`), and run
  `node --check` on every touched file.
- `tjs:sqlite`: `new Database(path, { readOnly: true })` is safe for reading
  another app's WAL database; set `PRAGMA busy_timeout` before any write.
- `tjs run script.js` resolves relative imports against the **current
  directory**, not the importing file — `cd` to the module's folder (or keep
  the script at the project root importing `./src/...`).

## Module layout rules (build-breaking if ignored)

- Plain-JS backends: the build copies the backend dir **minus a nested
  `frontend/`** and bundles the module graph. So the backend can never import
  from `src/frontend/`, and the page can't import backend modules either
  (the frontend is copied separately). Put shared pure logic where its single
  consumer lives; duplicate only if both sides truly need it.
- `import.meta.url` throws inside a compiled binary. A built app has no API
  exposing its frontend dir to the backend — when something needs a real path
  to a shipped asset (e.g. a tray icon), compute it **in the page**:
  `decodeURIComponent(new URL('./tray.png', location.href).pathname).replace(/^\/([A-Za-z]:)/, '$1')`.
- Keep IO in one module (`tjs.readFile/writeFile/rename/stat`, `fetch`) and the
  rest pure: then `node --test` can exercise parsers and rules without txiki.
  Reference `globalThis.tjs` lazily so importing under Node doesn't throw.
- API handlers can be called before `init(app)` runs — load persisted state in
  a module-level promise and `await` it in every handler.

## Window geometry

- `tiny.win.setSize/setPosition/getState` and `tiny.app.screens()` share one
  unit space. Don't assume it equals CSS px: derive the ratio
  `k = getState().width / window.innerWidth` and multiply page measurements by
  it. (At 100% scale k = 1.)
- `screens()[i].visible` is the work area (taskbar excluded) — no Win32 needed.
- Frameless + transparent main window: declare in tinyjs.json
  `"chrome": { "frame": false, "transparent": true, "windowControls": false }`
  (a late `setChrome` is too late on Windows). `body` must be transparent;
  draw the panel (radius, border, alpha) in CSS. Add `data-tiny-noresize` on
  `<html>` plus `tiny.win.setResizable(false)` to kill edge grips.
- Tray-style widget: `"activation": "accessory"` → no taskbar button
  (WS_EX_TOOLWINDOW) and the window **starts hidden**. Render, size, then
  `tiny.win.center(); tiny.win.show()` once — no placeholder-size flash.
- Minimise-to-tray on a toolwindow: `tiny.app.presence('normal')` (gives it a
  taskbar button so the minimised window isn't a stub above the taskbar),
  `tiny.tray.set({ icon, tooltip, menu, primaryAction: true })`,
  `tiny.win.minimize()`. On `tiny.win.onState(({win, minimized, focused}))`
  with `win === 'main' && !minimized && focused` → `tray.remove()` +
  `presence('menubar')`.
- Always-on-top: `tiny.win.setAlwaysOnTop(true)` at startup.
- Single instance is automatic for built apps (named pipe); a second launch
  activates the first.

## Live edge snapping during drag (replaces a WM_MOVING subclass)

Don't use `tiny.win.startDrag()` if you need to snap *during* the drag — the
OS drag loop gives you no hook. Move the window from the page instead:

1. `pointerdown` (button 0): `setPointerCapture`, record `screenX/screenY`,
   fetch `getState()` + `screens()` once.
2. `pointermove`: store the latest `screenX/screenY`; coalesce to one
   `requestAnimationFrame` per frame.
3. Apply: `raw = origin + (pointer − start) * k`; snap `raw` against the work
   area with a threshold of `16 * k`; `tiny.win.setPosition` only when the
   result changed.

Always derive from pointer travel since pointerdown, never from the last
snapped position — otherwise snapping compounds and welds the window to the
edge. Escaping then always costs exactly one threshold.

## Menus

- `tiny.menu.setContext([...])` replaces the webview's right-click menu
  **app-wide** (every window, including settings); handle clicks with
  `tiny.menu.onContext(id => …)` in the one page that owns the actions.
- `"contextMenu": false` in tinyjs.json suppresses the default menu.
- Native menus beat HTML ones in a small widget: nothing gets clipped.

## Backend networking (txiki `fetch`)

- It silently adds `Origin: https://<host>`, `Cache-Control: no-cache`,
  `Pragma: no-cache`, and the Origin **cannot be removed** (setting it to an
  empty string or omitting it changes nothing). APIs that reject browser-origin
  calls (Anthropic, for CORS-restricted orgs) need another client: spawn
  `%SystemRoot%\System32\curl.exe` — NOT the `curl.exe` on PATH, which Git's
  mingw build may shadow — with `--config -`, writing url/header/data-binary to
  stdin so tokens never appear in argv. Spawn through `app.spawnHidden` inside
  the app (plain `tjs.spawn` from the GUI exe opens a console — on Windows 11
  it shows up as a Windows Terminal window titled with the exe path). To
  verify, poll `EnumWindows` for new visible windows while the app starts
  (`CASCADIA_HOSTING_WINDOW_CLASS` / `PseudoConsoleWindow` = leak). Pipe API:
  `tjs.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })` →
  `proc.stdin.getWriter()`, `proc.stdout.getReader()`, `await proc.wait()`
  (`{ exit_status }`). Keep `-w` in argv; escapes inside config strings are fragile.
- Verify the wire with an echo service (`https://httpbin.org/anything`) and fake
  values — but a fake token can mask the real failure (auth is checked before
  CORS), so also read a real call's error body through the diagnostics script.
- txiki's TLS occasionally stalls ("Timed out waiting SSL"); a one-shot curl
  fallback on network-level failures keeps polling robust.
- No built-in timeout: race the fetch and `res.text()` against a timer.
- Form bodies: build `application/x-www-form-urlencoded` yourself.
- TLS-1.2-only hosts and root-path URLs fall back to system curl automatically.
- No `Intl` in the backend: format dates/numbers in the page. `Date.parse` on
  RFC 3339 with >3 fractional digits is engine-dependent — parse by regex.

## FFI into Win32 (`tjs:ffi`)

Exports in 26.6.0 include `dlopen`, `types`, `read`, `Pointer`, `CFunction`,
`bufferToString` — but **no `createPointer`** (that's newer). Patterns that work:

```js
const FFI = (await import('tjs:ffi')).default;          // lazy: Windows-only path
const { symbols } = FFI.dlopen('advapi32.dll', {
  CredReadW: { args: ['buffer', 'u32', 'u32', 'buffer'], returns: 'i32' },
  CredFree:  { args: ['pointer'], returns: 'void' },
});
// wide string in: Uint16Array + NUL → pass its bytes as 'buffer'
// out-pointer:   const out = new Uint8Array(8); … FFI.types.pointer.fromBuffer(out)
// struct field:  FFI.read.u32(ptr, offset); a pointer field:
//                FFI.types.pointer.fromBuffer(ptr.toUint8Array(8, offset))
// copy native memory out BEFORE freeing it: ptr.toUint8Array(n).slice()
```

GetLastError via a separate `kernel32` binding right after the failing call.
x64 `CREDENTIALW`: `CredentialBlobSize` at +32, `CredentialBlob` at +40.
`tiny.app.secrets` only reads the app's own namespaced secrets, not another
program's credentials.

## Safety boundary when debugging credentials

Never read or print another program's credentials (auth files, keyring
blobs) yourself — the harness blocks it, rightly. Write a diagnostics script
that prints only file existence, field **names**/types/lengths, expiry
times, HTTP statuses and error bodies, and ask the user to run it
(`! <command>`). See `manapoint/diagnose.js`.
