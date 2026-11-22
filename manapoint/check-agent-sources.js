// Invoked by scripts/check-without-opencode.mjs. Fetch now, bypassing the UI and
// its last-good cache. Do not emit raw errors, credentials or account identifiers.
import * as grok from "./src/providers/grok.js";
import * as go from "./src/providers/opencode_go.js";

const checks = [["Grok (Pi)", () => grok.collect({ piReadOnly: true })], ["OpenCode Go (direct)", () => go.collect()]];
const results = await Promise.all(checks.map(async ([label, run]) => {
  try {
    const reading = await run();
    if (!reading.windows.length) return { ok: false, line: `${label}: no quota windows` };
    return { ok: true, line: `${label}: fresh (${reading.windows.map((w) => w.kind).join(", ")})` };
  } catch (err) {
    // These categories are stable and safe; error details from providers aren't.
    const known = /Go 金鑰已失效/.test(err?.message ?? "") ? "key rejected" :
      ["NotReady", "Transient", "Failed"].includes(err?.kind) ? err.kind : "Error";
    return { ok: false, line: `${label}: ${known}` };
  }
}));
for (const r of results) console.log(r.line);
globalThis.tjs.exit(results.every((r) => r.ok) ? 0 : 1);
