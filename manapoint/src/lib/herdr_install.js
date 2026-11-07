// Installing Manapoint's embedded mod into Herdr Desktop.
//
// Triggered from the panel / tray right-click menu ("安裝 Herdr 內嵌版…").
// Tries local herdr-mod/install.ps1 candidates first, falling back to the remote
// one-liner from GitHub so standalone zip users can install without git clone.

import { encodeCommand } from "./relaunch.js";

export const HERDR_INSTALL_URL = "https://raw.githubusercontent.com/vux427/Manapoint/master/herdr-mod/install.ps1";

/**
 * Builds the PowerShell script that tries local candidates first, then falls back
 * to the remote one-line installer. Pure.
 */
export function buildInstallScript(customCandidates = []) {
  const candidates = [
    ".\\herdr-mod\\install.ps1",
    "..\\herdr-mod\\install.ps1",
    ...customCandidates,
  ];
  return [
    "$ErrorActionPreference = 'Stop'",
    "$found = $null",
    `foreach ($p in @(${candidates.map((c) => `'${c}'`).join(", ")})) {`,
    "  if (Test-Path $p) { $found = (Resolve-Path $p).Path; break }",
    "}",
    "if ($found) {",
    "  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $found",
    "} else {",
    `  irm ${HERDR_INSTALL_URL} | iex`,
    "}",
  ].join("\n");
}

/**
 * Run the installer using spawnHidden.
 */
export async function installHerdrMod(spawnHidden) {
  if (typeof spawnHidden !== "function") {
    throw new Error("無法執行安裝程序（spawnHidden 未就緒）");
  }
  const script = buildInstallScript();
  const proc = spawnHidden([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodeCommand(script),
  ], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const status = await proc.wait();
  if (status.exit_status !== 0) {
    throw new Error(`Herdr 模組安裝失敗 (exit code ${status.exit_status})`);
  }
  return { ok: true };
}
