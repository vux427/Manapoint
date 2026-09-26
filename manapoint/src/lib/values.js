// Shared parsing helpers. Deliberately strict where the Rust port was strict: a
// missing field is an error, because drawing a fabricated 0% bar would be worse than
// saying the shape changed.

import { failed } from "./errors.js";

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
export const isInteger = (v) => Number.isInteger(v);
export const isBlank = (s) => typeof s !== "string" || s.trim() === "";

/** A non-empty string, or null. */
export const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);

export function object(root, key, whose) {
  const v = isObject(root) ? root[key] : undefined;
  if (v === undefined || v === null) throw failed(`${whose} 回應缺少 '${key}'。`);
  return v;
}

export function number(node, key, whose) {
  const v = isObject(node) ? node[key] : undefined;
  if (!isNumber(v)) throw failed(`${whose} 回應的 '${key}' 不是數字。`);
  return v;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})?$/;

/**
 * ISO 8601 / RFC 3339 timestamp → epoch milliseconds, or null. A value without an
 * offset is read as UTC. Parsed by hand rather than with Date.parse: the backend
 * runtime (QuickJS) and V8 disagree on fractions longer than three digits, and
 * providers send six or seven.
 */
export function parseDatetime(raw) {
  if (typeof raw !== "string") return null;
  const m = DATETIME.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
  if (zone && zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    t -= sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
  }
  return Number.isNaN(t) ? null : t;
}

/** RFC 3339 string for the wire (CONTRACT.md §1.2), or null. */
export const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

/** Optional timestamp as an RFC 3339 string: absent, null or unreadable is null. */
export function optionalIso(node, key) {
  return iso(parseDatetime(isObject(node) ? node[key] : null));
}

/** A JWT's payload claims, unverified — used for hints (expiry, account id), never
 * for a security decision. Null when the token is not a JWT. */
export function jwtClaims(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const claims = JSON.parse(new TextDecoder().decode(base64ToBytes(b64)));
    return isObject(claims) ? claims : null;
  } catch {
    return null;
  }
}

/** `exp` (unix seconds) from a JWT payload, or null. */
export function jwtExp(token) {
  const exp = jwtClaims(token)?.exp;
  return isInteger(exp) ? exp : null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// The backend runtime has no atob guarantee across versions; decoding by hand keeps
// one code path under Node (tests) and txiki alike.
function base64ToBytes(b64) {
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const c of b64) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error("bad base64");
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
