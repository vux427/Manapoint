// The only module that touches the backend runtime's filesystem and network. Keeping
// IO here lets every parser and token rule stay pure and run under Node's test runner.

import { transient } from "./errors.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const rt = () => globalThis.tjs;

export const env = (name) => rt()?.env?.[name] ?? null;

/** File text, or null when it cannot be read — absence is a state, not an error. */
export async function readText(path) {
  try {
    return dec.decode(await rt().readFile(path));
  } catch {
    return null;
  }
}

export async function exists(path) {
  try {
    await rt().stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Plain write, creating the directory first. Failures surface to the caller. */
export async function writeText(path, text) {
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  await rt().makeDir(dir, { recursive: true }).catch(() => {});
  await rt().writeFile(path, enc.encode(text));
}

/**
 * Atomic write: a temp file beside the target, then a rename over it, so a crash
 * mid-write cannot corrupt someone's credential file. Returns false on failure — the
 * fresh token is already in memory for this round, so a failed write is not fatal.
 */
export async function replaceText(path, text) {
  const tmp = path + ".tmp";
  try {
    await rt().writeFile(tmp, enc.encode(text));
    await rt().rename(tmp, path);
    return true;
  } catch {
    await rt().remove(tmp).catch(() => {});
    return false;
  }
}

/** Every request gets the same ceiling as the Rust client had. */
const TIMEOUT_MS = 20_000;

/**
 * One HTTP round trip → { status, text }. Network failures and timeouts become
 * Transient errors; any status comes back as-is for the caller to judge.
 */
export async function request(url, { method = "GET", headers = {}, body, form, json } = {}) {
  const h = { ...headers };
  let payload = body;
  if (form) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    payload = Object.entries(form)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  } else if (json !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(transient("連線逾時")), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fetch(url, { method, headers: h, body: payload }), timeout]);
    const text = await Promise.race([res.text(), timeout]);
    return { status: res.status, text };
  } catch (err) {
    // The runtime's own TLS stack occasionally stalls on a handshake ("Timed out
    // waiting SSL"); the system curl (Schannel) is a second, independent path, so a
    // network-level failure gets one more try there before the card hears about it.
    clearTimeout(timer);
    try {
      return await requestNoOrigin(url, { method, headers, body, form, json });
    } catch {
      if (err && err.kind) throw err;
      throw transient(`連線失敗，稍後自動重試（${err && err.message ? err.message : err}）`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── requests without an Origin header ──────────────────────────────────────
// txiki's fetch always adds `Origin: https://<host>`, which Anthropic reads as a
// browser (CORS) call and refuses for organisations that disallow them. Windows has
// shipped curl since 10 1803, so those calls go through it instead. Everything
// secret (URL, headers, body) travels on curl's stdin as a config file, never on
// the command line where other processes could read it.

let spawner = (argv, opts) => rt().spawn(argv, opts);

/** The app's console-less spawn (app.spawnHidden): a built GUI app would otherwise
 * flash a console window for every curl run. */
export function setSpawner(fn) {
  spawner = fn;
}

/** A curl config string: backslashes and quotes escaped, line breaks flattened. */
const BACKSLASH = String.fromCharCode(92);
const curlQuote = (s) =>
  '"' +
  String(s)
    .replace(/[\r\n]+/g, " ")
    .split(BACKSLASH)
    .join(BACKSLASH + BACKSLASH)
    .split('"')
    .join(BACKSLASH + '"') +
  '"';

async function readAll(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out;
    out += dec.decode(value, { stream: true });
  }
}

const STATUS_MARK = "\n__manapoint_status__:";

/** Same contract as request(), carried out by the system curl. */
export async function requestNoOrigin(url, { method = "GET", headers = {}, body: raw, form, json } = {}) {
  const h = { ...headers };
  let body = typeof raw === "string" ? raw : null;
  if (form) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  } else if (json !== undefined) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const config = [
    `url = ${curlQuote(url)}`,
    `request = ${curlQuote(method)}`,
    ...Object.entries(h).map(([k, v]) => `header = ${curlQuote(`${k}: ${v}`)}`),
    ...(body === null ? [] : [`data-binary = ${curlQuote(body)}`]),
  ].join("\n") + "\n";

  const curl = `${(env("SystemRoot") || "C:/Windows").split("\\").join("/")}/System32/curl.exe`;
  let proc;
  try {
    proc = spawner([curl, "-sS", "--max-time", String(TIMEOUT_MS / 1000), "--config", "-", "-w", `${STATUS_MARK}%{http_code}`], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw transient(`找不到系統 curl，無法連線（${err.message}）`);
  }
  const writer = proc.stdin.getWriter();
  await writer.write(enc.encode(config));
  await writer.close();
  const [out, errText, status] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr), proc.wait()]);

  const at = out.lastIndexOf(STATUS_MARK);
  const code = at < 0 ? 0 : Number(out.slice(at + STATUS_MARK.length));
  if (status.exit_status !== 0 || !code) {
    // 28 is curl's timeout; anything else is a connection-level failure.
    if (status.exit_status === 28) throw transient("連線逾時");
    throw transient(`連線失敗，稍後自動重試（${errText.trim() || "curl " + status.exit_status}）`);
  }
  return { status: code, text: out.slice(0, at) };
}
