// Cursor owns this WAL database. Read one auth entry without ever opening a writer.

import { transient } from "./errors.js";
import { exists } from "./io.js";
import { cursorStateDb } from "./paths.js";

async function openReadOnly(path) {
  const { Database } = await import("tjs:sqlite");
  return new Database(path, { readOnly: true });
}

export async function readAccessToken(open = openReadOnly) {
  const path = cursorStateDb();
  if (!(await exists(path))) return null;
  let db, statement;
  try {
    db = await open(path);
    db.exec("PRAGMA busy_timeout = 3000");
    statement = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1");
    const value = statement.all()[0]?.value;
    return typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : null;
  } catch {
    // SQLite errors can include local data; only a fixed instruction reaches the card.
    throw transient("無法讀取 Cursor 登入資料庫，請稍後重試");
  } finally {
    try { statement?.finalize(); } finally { db?.close(); }
  }
}
