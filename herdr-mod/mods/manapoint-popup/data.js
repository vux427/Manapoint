// Data fetching for Manapoint Herdr integration:
// 1. First tries local loopback API http://127.0.0.1:47901/v1/cards (fast, <10ms when app is running).
// 2. If app is not running, falls back to exec(manapoint-cli.exe).

import { exec, appHome, home, readTextFile, shared, setShared } from "herdr";

const LOCAL_API_URL = "http://127.0.0.1:47901/v1/cards";
const LOCAL_HISTORY_URL = "http://127.0.0.1:47901/v1/history";
const FETCH_TIMEOUT_MS = 1500;

let isFetching = false;
let isFetchingHistory = false;

export async function fetchCards() {
  if (isFetching) return shared("manapoint.cards");
  isFetching = true;
  setShared("manapoint.loading", true);

  try {
    // 1. Try loopback API if available
    try {
      const res = await fetch(LOCAL_API_URL);
      if (res && res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.cards) && json.cards.length > 0) {
          setShared("manapoint.cards", json.cards);
          setShared("manapoint.updatedAt", Date.now());
          setShared("manapoint.source", "app");
          return json.cards;
        }
      }
    } catch (_fetchErr) {
      // Loopback API not answering; fall through to CLI execution
    }

    // 2. Fall back to bundled standalone CLI
    const appDir = (appHome() || "").replace(/\\/g, "/");
    const userDir = (home() || "").replace(/\\/g, "/");
    const candidates = [
      `${appDir}/mods/manapoint-status/bin/manapoint-cli.exe`,
      "D:/WorkNiteProject/Manapoint/dist/herdr/manapoint-cli.exe",
      `${userDir}/AppData/Local/tinyjs/bin/tjs.exe`,
    ];

    for (const bin of candidates) {
      try {
        let r;
        if (bin.endsWith("tjs.exe")) {
          r = await exec(bin, ["run", "D:/WorkNiteProject/Manapoint/manapoint/src/cli.js", "--deadline", "15000"]);
        } else {
          r = await exec(bin, ["--deadline", "15000"]);
        }

        if (r) {
          setShared("manapoint.last_exec", { bin, code: r.code, stdoutLen: (r.stdout || "").length, stderr: r.stderr });
        }

        if (r && r.code === 0 && r.stdout) {
          const lines = r.stdout.trim().split("\n");
          const lastLine = lines[lines.length - 1];
          const parsed = JSON.parse(lastLine);
          if (parsed && Array.isArray(parsed.cards)) {
            setShared("manapoint.cards", parsed.cards);
            setShared("manapoint.updatedAt", Date.now());
            setShared("manapoint.source", "cli");
            return parsed.cards;
          }
        }
      } catch (execErr) {
        setShared("manapoint.last_exec_err", { bin, err: String(execErr?.message ?? execErr) });
      }
    }
  } catch (err) {
    console.error("[manapoint] fetchCards error:", err?.stack || err?.message || String(err));
  } finally {
    isFetching = false;
    setShared("manapoint.loading", false);
  }

  return shared("manapoint.cards");
}

export async function saveEnabledProviders(ids) {
  setShared("manapoint.enabledProviders", ids);
  const appDir = (appHome() || "").replace(/\\/g, "/");
  const candidates = [
    `${appDir}/mods/manapoint-status/bin/manapoint-cli.exe`,
    "D:/WorkNiteProject/Manapoint/dist/herdr/manapoint-cli.exe",
  ];
  for (const bin of candidates) {
    try {
      const r = await exec(bin, ["--set-enabled-providers", ids.join(",")]);
      if (r && r.code === 0) break;
    } catch {}
  }
  fetchCards();
}

export async function fetchUsageHistory() {
  if (isFetchingHistory) return shared("manapoint.history") ?? [];
  isFetchingHistory = true;
  setShared("manapoint.historyLoading", true);

  try {
    // 1. Try loopback API if available
    try {
      const res = await fetch(LOCAL_HISTORY_URL);
      if (res && res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.history)) {
          setShared("manapoint.history", json.history);
          setShared("manapoint.historyUpdatedAt", Date.now());
          return json.history;
        }
      }
    } catch {}

    // 2. Direct read from %APPDATA%/Manapoint/usage-history.json
    const userDir = (home() || "").replace(/\\/g, "/");
    const candidates = [
      `${userDir}/AppData/Roaming/Manapoint/usage-history.json`,
      `${userDir}/.config/Manapoint/usage-history.json`,
      `${userDir}/.config/manapoint/usage-history.json`,
    ];
    for (const f of candidates) {
      try {
        if (typeof readTextFile === "function") {
          const text = await readTextFile(f);
          if (text) {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              setShared("manapoint.history", parsed);
              setShared("manapoint.historyUpdatedAt", Date.now());
              return parsed;
            }
          }
        }
      } catch {}
    }

    // 3. Fall back to CLI execution with --history
    const appDir = (appHome() || "").replace(/\\/g, "/");
    const binCandidates = [
      `${appDir}/mods/manapoint-status/bin/manapoint-cli.exe`,
      "D:/WorkNiteProject/Manapoint/dist/herdr/manapoint-cli.exe",
      `${userDir}/AppData/Local/tinyjs/bin/tjs.exe`,
    ];
    for (const bin of binCandidates) {
      try {
        let r;
        if (bin.endsWith("tjs.exe")) {
          r = await exec(bin, ["run", "D:/WorkNiteProject/Manapoint/manapoint/src/cli.js", "--history"]);
        } else {
          r = await exec(bin, ["--history"]);
        }
        if (r && r.code === 0 && r.stdout) {
          const lines = r.stdout.trim().split("\n");
          const parsed = JSON.parse(lines[lines.length - 1]);
          if (parsed && Array.isArray(parsed.history)) {
            setShared("manapoint.history", parsed.history);
            setShared("manapoint.historyUpdatedAt", Date.now());
            return parsed.history;
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error("[manapoint] fetchUsageHistory error:", err?.stack || err?.message || String(err));
  } finally {
    isFetchingHistory = false;
    setShared("manapoint.historyLoading", false);
  }

  return shared("manapoint.history") ?? [];
}
