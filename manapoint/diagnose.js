// Manapoint diagnostics: why is a card red? Run from this directory:
//
//   %LOCALAPPDATA%\tinyjs\bin\tjs.exe run diagnose.js
//
// Prints only what is safe to paste into an issue: which credential files exist,
// the NAMES of the fields inside them (never the values), token expiry times, and
// each provider's result or error. No token, key or secret is ever printed.

import { readText, exists } from "./src/lib/io.js";
import { claudeCredentials, codexAuth, opencodeAuth } from "./src/lib/paths.js";
import { readGeneric } from "./src/lib/keyring.js";
import * as registry from "./src/providers/registry.js";

/** Written as a char code: some editors silently turn the escape into the character. */
const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

/** Field names and value types, recursively; string values are replaced by a length. */
function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})` + (v.length && depth < 3 ? ` of ${shape(v[0], depth + 1)}` : "");
  if (typeof v === "object") {
    if (depth >= 3) return "{…}";
    return "{ " + Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1)}`).join(", ") + " }";
  }
  if (typeof v === "string") return `string(${v.length})`;
  return typeof v;
}

function expiry(label, ms) {
  if (typeof ms !== "number" || !(ms > 0)) return `${label}: (none)`;
  const mins = Math.round((ms - Date.now()) / 60000);
  return `${label}: ${new Date(ms).toISOString()} (${mins >= 0 ? "in " + mins : -mins + " ago"} min)`;
}

async function file(label, path, extra) {
  console.log(`\n## ${label}\n  path: ${path}`);
  if (!(await exists(path))) return console.log("  exists: no");
  const text = await readText(path);
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    return console.log(`  exists: yes, but not JSON (${err.message})`);
  }
  console.log(`  shape: ${shape(root)}`);
  extra?.(root);
}

await file("opencode auth.json", opencodeAuth(), (root) => {
  if (root?.xai?.expires) console.log("  " + expiry("xai.expires", root.xai.expires));
});
await file("Claude .credentials.json", claudeCredentials(), (root) => {
  const o = root?.claudeAiOauth;
  if (o) console.log("  " + expiry("claudeAiOauth.expiresAt", o.expiresAt ?? o.expires_at));
});
await file("Codex auth.json", codexAuth());

console.log("\n## Antigravity keyring (gemini:antigravity)");
try {
  const blob = await readGeneric("gemini:antigravity");
  if (!blob) console.log("  credential: not found");
  else {
    console.log(`  credential: ${blob.length} bytes`);
    try {
      const root = JSON.parse(new TextDecoder().decode(blob).replace(BOM, ""));
      console.log(`  shape: ${shape(root)}`);
    } catch (err) {
      console.log(`  not JSON: ${err.message}`);
    }
  }
} catch (err) {
  console.log(`  read failed: ${err.message}`);
}

console.log("\n## Providers");
for (const p of registry.all()) {
  try {
    const u = await p.collect();
    const bars = u.windows.map((w) => `${w.kind} ${w.percent.toFixed(1)}%`).join(", ");
    console.log(`  ${p.id}: OK  ${bars || "(no windows)"}${u.note ? "  note: " + u.note : ""}`);
  } catch (err) {
    const detail = err.detail ? `\n      body: ${err.detail}` : "";
    console.log(`  ${p.id}: ${err.kind ?? "Error"}  ${err.message}${detail}`);
  }
}
