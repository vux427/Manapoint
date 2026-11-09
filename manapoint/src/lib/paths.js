// Where each CLI keeps its login, and where Manapoint keeps its own two files.
// Forward slashes throughout: the Windows APIs underneath accept them.

import { env } from "./io.js";

const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");

export function home() {
  return norm(env("USERPROFILE") || env("HOME") || globalThis.tjs?.homeDir || "");
}

/** %APPDATA%\Manapoint — the same folder the Tauri build used, so settings carry over. */
export function appDataDir() {
  const base = env("APPDATA");
  return (base ? norm(base) : home() + "/.config") + "/Manapoint";
}

/** The opencode CLI's credential file. The opencode Go key and the xAI OAuth tokens
 * both live here, so the two collectors share this derivation. */
export function opencodeAuth() {
  const xdg = env("XDG_DATA_HOME");
  const dataHome = xdg && xdg.trim() ? norm(xdg) : home() + "/.local/share";
  return dataHome + "/opencode/auth.json";
}

export const claudeCredentials = () => home() + "/.claude/.credentials.json";
export const codexAuth = () => home() + "/.codex/auth.json";

/** Cursor CLI supports both current and legacy auth files across config homes. */
export function cursorAuthPaths() {
  const base = env("CURSOR_ACP_HOME_DIR")?.trim() || home();
  const xdg = env("XDG_CONFIG_HOME")?.trim();
  const dirs = [xdg ? norm(xdg) + "/cursor" : null, norm(base) + "/.config/cursor", norm(base) + "/.cursor"];
  return [...new Set(dirs.filter(Boolean))].flatMap((dir) => [dir + "/cli-config.json", dir + "/auth.json"]);
}

/** Cursor's desktop login on Windows; Linux uses the XDG config home. */
export function cursorStateDb() {
  const appData = env("APPDATA")?.trim();
  const xdg = env("XDG_CONFIG_HOME")?.trim();
  return (appData ? norm(appData) : xdg ? norm(xdg) : home() + "/.config") + "/Cursor/User/globalStorage/state.vscdb";
}

/** Muse uses the file credential backend on Windows and Linux. */
export function museAuth() {
  const override = env("MUSE_AUTH_PATH");
  if (override && override.trim()) return override.trim().replace(/\\/g, "/");
  const xdg = env("XDG_CONFIG_HOME");
  return (xdg && xdg.trim() ? norm(xdg) : home() + "/.config") + "/muse/auth.json";
}
