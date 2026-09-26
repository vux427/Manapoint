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
