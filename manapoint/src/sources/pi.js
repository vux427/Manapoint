// Pi's headless SDK owns xAI OAuth resolution and writes (including its file lock).
// Run a bundled probe rather than starting Pi, discovering project extensions, or
// copying auth.json. Only selected billing fields and an in-memory account hint
// cross the process boundary. No credentials go on argv or stdout.
import { notReady, transient } from "../lib/errors.js";
import { env, exists, readText, runLocalProbe } from "../lib/io.js";
import { home } from "../lib/paths.js";

const absolute = (p) => {
  const path = p?.trim().replace(/\\/g, "/");
  return path && /^(?:[a-z]:\/|\/)/i.test(path) ? path : null;
};
const sdkSuffix = "/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

async function sdkEntry() {
  const configured = absolute(env("MANAPOINT_PI_SDK_ENTRY"));
  if (configured) return await exists(configured) ? configured : null;
  const root = absolute(env("PI_MANAGED_INSTALL_ROOT")) ?? home() + "/.pi/agent/install";
  const version = (await readText(root + "/current-version"))?.trim();
  if (version && /^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
    const managed = `${root}/releases/${version}${sdkSuffix}`;
    if (await exists(managed)) return managed;
  }
  const appData = absolute(env("APPDATA"));
  const npm = appData && appData + "/npm" + sdkSuffix;
  return npm && await exists(npm) ? npm : null;
}

async function nodePath() {
  const configured = absolute(env("MANAPOINT_NODE_EXE"));
  if (configured) return await exists(configured) ? configured : null;
  for (const prefix of [env("ProgramW6432"), env("ProgramFiles"), "C:/Program Files"]) {
    const root = absolute(prefix);
    if (root && await exists(root + "/nodejs/node.exe")) return root + "/nodejs/node.exe";
  }
  return null;
}

export async function piGrokRoutes(parse, { readOnly = false } = {}) {
  const agentDir = absolute(env("PI_CODING_AGENT_DIR")) ?? home() + "/.pi/agent";
  const authPath = agentDir + "/auth.json";
  if (!(await exists(authPath))) return [];
  return [{
    label: "Pi",
    async run() {
      const [entry, node] = await Promise.all([sdkEntry(), nodePath()]);
      if (!entry || !node) throw notReady("找不到 Pi SDK 或 Node.js；請確認 Pi 已安裝或設定路徑覆寫");
      const text = await runLocalProbe([node, "--input-type=module", "-", entry, authPath, readOnly ? "read-only" : "refresh"], PI_GROK_PROBE, agentDir);
      let result;
      try { result = JSON.parse(text); } catch { throw transient("Pi 額度轉接器回應異常"); }
      if (result?.version !== 1) throw transient("Pi 額度轉接器版本不相容");
      if (result.status === "login") throw notReady("尚未登入或授權已失效；請在 Pi 用 /login 登入 xAI 訂閱");
      if (result.status === "denied") throw notReady("Pi 的 xAI 登入無法讀取訂閱額度；請確認帳號及訂閱");
      if (result.status === "sdk") throw notReady("Pi SDK 不相容；請確認已安裝支援 ModelRuntime 的 Pi");
      if (result.status === "format") throw transient("Pi 的 Grok 額度回應格式不符，顯示上次數字");
      if (result.status !== "ok") throw transient("Pi 的 Grok 額度暫時無法查詢，稍後自動重試");
      return { ...parse(JSON.stringify({ config: result.config }), Date.now()), identity: result.identity };
    },
  }];
}

// Passed to Node on stdin so the same probe is embedded in desktop and headless builds.
export const PI_GROK_PROBE = String.raw`
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [entry, authPath, mode] = process.argv.slice(2);
const reply = (status, extra = {}) => ({ version: 1, status, ...extra });
const idOf = (token) => {
  try {
    const { iss, sub } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    if (typeof iss === 'string' && iss && typeof sub === 'string' && sub) return JSON.stringify([iss, sub]);
  } catch {}
};
const scalar = (x) => typeof x === 'number' ? x : typeof x?.val === 'number' ? { val: x.val } : undefined;
const date = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[Zz]|[+-]\d{2}:\d{2})?$/.test(x) ? x : undefined;
async function collect() {
  // Peek at the documented auth store only to reject absent/API-key logins before
  // loading the SDK. Do not intentionally resolve API-key logins or Pi model settings.
  let credential;
  try { credential = JSON.parse(await readFile(authPath, 'utf8'))?.xai; } catch { return reply('login'); }
  if (credential?.type !== 'oauth') return reply('login');
  if (mode === 'read-only' && !(credential.expires > Date.now())) return reply('login');
  let ModelRuntime;
  try { ({ ModelRuntime } = await import(pathToFileURL(entry).href)); } catch { return reply('sdk'); }
  if (typeof ModelRuntime?.create !== 'function') return reply('sdk');
  // Smoke tests never write/refresh the user's Pi grant. Normal polling relies on
  // the SDK's own locked storage, and ignores project models, configs and extensions.
  const credentials = mode === 'read-only' ? {
    read: async (id) => id === 'xai' ? credential : undefined,
    list: async () => [{ providerId: 'xai', type: 'oauth' }],
    modify: async () => { throw new Error('read-only'); },
    delete: async () => { throw new Error('read-only'); },
  } : undefined;
  let runtime;
  let auth;
  try {
    runtime = await ModelRuntime.create({ authPath, credentials, modelsPath: null, refreshOnCreate: false });
    if ((await runtime.checkAuth('xai'))?.type !== 'oauth') return reply('login');
    auth = await runtime.getAuth('xai', { minOAuthValidityMs: 0, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return reply(/invalid_grant|HTTP (400|401)\b/.test(String(err?.message)) ? 'login' : 'unavailable');
  } finally {
    await runtime?.settleCredentialWrites?.();
  }
  const token = auth?.source === 'OAuth' ? auth.auth?.apiKey : null;
  if (!token) return reply('login');
  const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    headers: { Authorization: 'Bearer ' + token, 'x-xai-token-auth': 'xai-grok-cli', accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 || res.status === 403) return reply('denied');
  if (!res.ok) return reply('unavailable');
  let config;
  try { config = (await res.json())?.config; } catch { return reply('format'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return reply('format');
  return reply('ok', { identity: idOf(token), config: {
    creditUsagePercent: typeof config.creditUsagePercent === 'number' ? config.creditUsagePercent : undefined,
    isUnifiedBillingUser: config.isUnifiedBillingUser === true,
    currentPeriod: { type: String(config.currentPeriod?.type ?? '').includes('WEEKLY') ? 'WEEKLY' : undefined, end: date(config.currentPeriod?.end) },
    billingPeriodEnd: date(config.billingPeriodEnd),
    productUsage: (Array.isArray(config.productUsage) ? config.productUsage : [])
      .filter((p) => typeof p?.usagePercent === 'number').map((p) => ({ usagePercent: p.usagePercent })),
    ...Object.fromEntries(['monthlyLimit', 'used', 'onDemandCap', 'onDemandUsed', 'prepaidBalance'].map((k) => [k, scalar(config[k])])),
  } });
}
try { process.stdout.write(JSON.stringify(await collect())); } catch { process.stdout.write(JSON.stringify(reply('unavailable'))); }
`;
