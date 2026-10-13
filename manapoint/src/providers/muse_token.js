// Only the CLI's device-code login can read subscription quota. Inference keys
// belong to another API, so never send them to the subscription endpoint.

import { failed, notReady } from "../lib/errors.js";
import { readText } from "../lib/io.js";
import { museAuth } from "../lib/paths.js";
import { isObject, str } from "../lib/values.js";

export const LOGIN_MESSAGE = "尚未登入 Muse Code，請執行 muse login";

/** An inline login wins over any other credential belonging to the CLI. */
export function parseEntry(root) {
  const meta = isObject(root) && isObject(root.providers) ? root.providers.meta : null;
  const access = isObject(meta) ? str(meta.access_token)?.trim() : null;
  // Invalid header bytes can make HTTP clients echo the secret in an error.
  return access && access.startsWith("dca:") && access.length > 4 && /^[\x21-\x7E]+$/.test(access)
    ? { access } : null;
}

export async function accessToken() {
  const text = await readText(museAuth());
  if (text === null) throw notReady(LOGIN_MESSAGE);
  let root;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    // JSON errors can quote credential values; only a fixed message may leave here.
    throw failed("Muse Code 登入檔格式不符，請執行 muse login");
  }
  const entry = parseEntry(root);
  if (!entry) throw notReady("Muse Code 缺少訂閱登入憑證，請執行 muse login（API key 無法查詢訂閱用量）");
  // No documented device-token refresh exists. Re-read on each poll so a CLI
  // login immediately replaces a rejected token without writing to its auth file.
  return entry.access;
}
