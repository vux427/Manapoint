// Snapshot of the last successful reading per card (%APPDATA%\Manapoint\
// usage-snapshot.json). A cold start or a rate limit shows the old numbers instead of
// a column of red. It holds only percentages and reset times — never a credential.
// The shape matches what the Tauri build wrote, so an upgrade keeps its numbers.

import { readText, writeText } from "./io.js";
import { appDataDir } from "./paths.js";

const file = () => appDataDir() + "/usage-snapshot.json";

/** Missing or corrupt reads as empty — a lost cache is not worth failing over. */
export async function load() {
  const text = await readText(file());
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function save(snapshot) {
  try {
    await writeText(file(), JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error("[manapoint] usage snapshot not saved:", err?.message ?? err);
  }
}
