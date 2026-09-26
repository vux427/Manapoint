// opencode's credential store. Current opencode keeps logins in the `credential`
// table of opencode.db (SQLite, WAL) rather than auth.json, which newer versions
// leave behind untouched:
//
//   credential(id, integration_id, label, value JSON, active, time_created, time_updated)
//   value = { type: 'oauth', methodID, access, refresh, expires, metadata? }
//         | { type: 'key', key, metadata? }
//
// Location follows opencode: OPENCODE_DB, else $XDG_DATA_HOME/opencode/opencode.db,
// else ~/.local/share/opencode/opencode.db. Reads are read-only connections; the one
// write (a refreshed OAuth token) merges into the row inside an immediate
// transaction, so opencode's own writes are never interleaved with ours.

import { env, exists } from "./io.js";
import { home } from "./paths.js";
import { isObject } from "./values.js";

export function dbPath() {
  const override = env("OPENCODE_DB");
  if (override && override.trim()) return override.split("\\").join("/");
  const xdg = env("XDG_DATA_HOME");
  const dataHome = xdg && xdg.trim() ? xdg.split("\\").join("/") : home() + "/.local/share";
  return dataHome + "/opencode/opencode.db";
}

async function open(readOnly) {
  const path = dbPath();
  if (!(await exists(path))) return null;
  const { Database } = await import("tjs:sqlite");
  const db = new Database(path, { readOnly });
  // opencode may hold the write lock for a moment; wait rather than fail the poll.
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
}

/** Parsed rows for one integration, active ones first. Pure. */
export function parseRows(rows) {
  return rows
    .map((r) => {
      let value = null;
      try {
        value = JSON.parse(r.value);
      } catch {
        // an unreadable row is skipped, not fatal
      }
      return isObject(value)
        ? { id: r.id, label: r.label ?? null, active: r.active === 1, value }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.active) - Number(a.active));
}

/** Every stored credential for `integrationId` ('xai', 'opencode', 'google', …).
 * An absent database or table reads as none. */
export async function credentials(integrationId) {
  let db;
  try {
    db = await open(true);
    if (!db) return [];
    const st = db.prepare(
      "SELECT id, label, value, active FROM credential WHERE integration_id = ? ORDER BY time_created",
    );
    const rows = st.all(integrationId);
    st.finalize();
    return parseRows(rows);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Merge `patch` into one row's value (re-read inside the transaction, so fields
 * opencode wrote meanwhile survive). Returns false when the write did not happen —
 * the fresh token is already in memory for this round, so that is not fatal.
 */
export async function updateCredential(id, patch) {
  let db;
  try {
    db = await open(false);
    if (!db) return false;
    db.exec("BEGIN IMMEDIATE");
    const read = db.prepare("SELECT value FROM credential WHERE id = ?");
    const row = read.all(id)[0];
    read.finalize();
    if (!row) {
      db.exec("ROLLBACK");
      return false;
    }
    const merged = { ...JSON.parse(row.value), ...patch };
    const write = db.prepare("UPDATE credential SET value = ?, time_updated = ? WHERE id = ?");
    write.run(JSON.stringify(merged), Date.now(), id);
    write.finalize();
    db.exec("COMMIT");
    return true;
  } catch {
    try {
      db?.exec("ROLLBACK");
    } catch {
      // nothing to roll back
    }
    return false;
  } finally {
    db?.close();
  }
}
