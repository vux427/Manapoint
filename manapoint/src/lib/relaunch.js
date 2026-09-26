// Coming back after an auto-update.
//
// tinyjs's own relaunch starts the new exe while this instance is still alive, and
// single-instance activation makes the newcomer hand over to us and exit, so after
// an update nothing would be running. Anything this process spawns also dies with
// it. So before the install starts, a helper is created through WMI (a parent
// outside our process tree): it waits for this process to end, and starts the exe
// again only if the flag file is still there (a failed install removes it).

import { removeFile, writeText } from "./io.js";
import { appDataDir } from "./paths.js";

export const flagFile = () => appDataDir() + "/relaunch.flag";

/** PowerShell's -EncodedCommand: base64 of the UTF-16LE script, so nothing needs quoting. */
export function encodeCommand(script) {
  let bin = "";
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff, c >> 8);
  }
  return btoa(bin);
}

const psQuote = (s) => "'" + String(s).split("'").join("''") + "'";

/** The detached helper, and the short script that creates it with no window. */
export function helperScripts({ pid, exe, flag }) {
  const helper = [
    `Wait-Process -Id ${pid} -Timeout 900 -ErrorAction SilentlyContinue`,
    `if (Test-Path -LiteralPath ${psQuote(flag)}) {`,
    `  Remove-Item -LiteralPath ${psQuote(flag)} -ErrorAction SilentlyContinue`,
    `  Start-Process -FilePath ${psQuote(exe)}`,
    `}`,
  ].join("\n");
  const commandLine = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodeCommand(helper)}`;
  const launcher = [
    `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }`,
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; ProcessStartupInformation = $si } | Out-Null`,
  ].join("\n");
  return { helper, launcher };
}

/**
 * Start the helper and wait until WMI has created it; the flag is set from here on,
 * because the install quits this process a moment after it succeeds. Throws if the
 * helper could not be created.
 */
export async function arm(spawnHidden) {
  const tjs = globalThis.tjs;
  const flag = flagFile();
  await writeText(flag, String(Date.now()));
  const { launcher } = helperScripts({ pid: tjs.pid, exe: tjs.exePath, flag });
  const proc = spawnHidden(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(launcher)], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const status = await proc.wait();
  if (status.exit_status !== 0) {
    await disarm();
    throw new Error(`relaunch helper failed (${status.exit_status})`);
  }
}

/** The install failed and this process stays: the helper must not start a second copy. */
export const disarm = () => removeFile(flagFile());
