// Live, non-destructive uninstall preflight (Windows).
// Use an empty profile/search path for OpenCode, keeping access to the real Pi
// installation. The probe may read (but never refresh) the stored xAI login.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const originalHome = process.env.USERPROFILE || process.env.HOME || homedir();
const profile = mkdtempSync(join(tmpdir(), "manapoint-no-opencode-"));
try {
  const tjs = process.env.MANAPOINT_TJS_EXE || join(process.env.LOCALAPPDATA || originalHome, "tinyjs", "bin", "tjs.exe");
  if (!isAbsolute(tjs)) throw new Error("MANAPOINT_TJS_EXE must be an absolute path");
  const agent = process.env.PI_CODING_AGENT_DIR || join(originalHome, ".pi", "agent");
  const install = process.env.PI_MANAGED_INSTALL_ROOT || join(originalHome, ".pi", "agent", "install");
  const env = { ...process.env };
  const npmEntry = process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
  if (!env.MANAPOINT_PI_SDK_ENTRY && !existsSync(join(install, "current-version")) && npmEntry && existsSync(npmEntry)) {
    env.MANAPOINT_PI_SDK_ENTRY = npmEntry;
  }
  for (const k of Object.keys(env)) {
    if (["PATH", "MANAPOINT_GROK_SOURCE", "MANAPOINT_GO_SOURCE", "NODE_OPTIONS"].includes(k.toUpperCase())) delete env[k];
  }
  Object.assign(env, {
    HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
    XDG_DATA_HOME: profile, XDG_CONFIG_HOME: profile, XDG_STATE_HOME: profile,
    OPENCODE_DB: join(profile, "missing-opencode.db"),
    PI_CODING_AGENT_DIR: agent, PI_MANAGED_INSTALL_ROOT: install,
    MANAPOINT_NODE_EXE: process.execPath,
    Path: [dirname(process.execPath), join(process.env.SystemRoot || "C:\\Windows", "System32")].join(delimiter),
  });
  const cwd = fileURLToPath(new URL("../manapoint/", import.meta.url));
  const result = spawnSync(tjs, ["run", "check-agent-sources.js"], { cwd, env, stdio: "inherit", timeout: 55_000 });
  if (result.error) console.error(`Preflight could not run (${result.error.code || "runtime error"}).`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
