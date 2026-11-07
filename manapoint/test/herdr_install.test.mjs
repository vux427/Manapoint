import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInstallScript, installHerdrMod, HERDR_INSTALL_URL } from "../src/lib/herdr_install.js";

describe("herdr install helper", () => {
  it("builds PowerShell script checking local paths and falling back to remote URL", () => {
    const script = buildInstallScript();
    assert.match(script, /herdr-mod\\install\.ps1/);
    assert.match(script, /irm https:\/\/raw\.githubusercontent\.com/);
    assert.match(script, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File \$found/);
  });

  it("accepts custom candidate paths", () => {
    const script = buildInstallScript(["C:\\custom\\install.ps1"]);
    assert.match(script, /C:\\custom\\install\.ps1/);
  });

  it("spawns hidden powershell with encoded command and waits for completion", async () => {
    let capturedArgs = null;
    let capturedOpts = null;
    const fakeSpawn = (argv, opts) => {
      capturedArgs = argv;
      capturedOpts = opts;
      return {
        wait: async () => ({ exit_status: 0 }),
      };
    };

    const res = await installHerdrMod(fakeSpawn);
    assert.deepEqual(res, { ok: true });
    assert.equal(capturedArgs[0], "powershell.exe");
    assert.equal(capturedArgs[3], "-EncodedCommand");
    assert.ok(typeof capturedArgs[4] === "string" && capturedArgs[4].length > 10);
    assert.equal(capturedOpts.stdin, "ignore");
  });

  it("throws when installer process exits with non-zero code", async () => {
    const fakeSpawn = () => ({
      wait: async () => ({ exit_status: 1 }),
    });

    await assert.rejects(installHerdrMod(fakeSpawn), /exit code 1/);
  });
});
