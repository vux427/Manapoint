// CLI path discovery follows opencode-cursor. Only a user access token can query
// subscription usage; CURSOR_API_KEY and OpenCode's placeholder keys cannot.

import { readAccessToken } from "../lib/cursor_db.js";
import { failed, notReady } from "../lib/errors.js";
import { readText } from "../lib/io.js";
import { cursorAuthPaths } from "../lib/paths.js";
import { isObject, jwtClaims } from "../lib/values.js";

export const LOGIN_MESSAGE = "請登入 Cursor 桌面程式，或執行 cursor-agent login";

/** Claims identify duplicate routes only; the server validates the session. */
export function sessionFromToken(value) {
  if (typeof value !== "string") return null;
  const access = value.trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access)) return null;
  const sub = jwtClaims(access)?.sub;
  const identity = typeof sub === "string" ? sub.split("|").pop() : null;
  if (!identity || !/^[A-Za-z0-9._-]+$/.test(identity)) return null;
  return { access, identity, cookie: `WorkosCursorSessionToken=${encodeURIComponent(identity + "::" + access)}` };
}

async function readCliToken(path) {
  const text = await readText(path);
  if (text === null) return null;
  let root;
  try { root = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw failed("Cursor 登入檔格式不符，請執行 cursor-agent login 重新登入"); }
  if (!isObject(root)) throw failed("Cursor 登入檔格式不符，請執行 cursor-agent login 重新登入");
  return root.accessToken ?? null;
}

/** Discover every local source; a bad source must not prevent another from working. */
export async function logins(readDbToken = readAccessToken) {
  const sources = [
    ...cursorAuthPaths().map((path) => ({ label: "Cursor CLI", read: () => readCliToken(path) })),
    { label: "Cursor 桌面程式", read: readDbToken },
  ];
  const candidates = await Promise.all(sources.map(async (source) => {
    try {
      const token = await source.read();
      if (token === null) return null;
      const session = sessionFromToken(token);
      if (!session) throw notReady("Cursor 登入無法用於查詢訂閱用量，請執行 cursor-agent login 重新登入");
      return { ...source, session };
    } catch (error) {
      return { ...source, error };
    }
  }));
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    if (candidate.error) return true;
    if (seen.has(candidate.session.access)) return false;
    seen.add(candidate.session.access);
    return true;
  });
}
