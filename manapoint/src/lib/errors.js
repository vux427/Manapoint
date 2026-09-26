// Why a collection failed, which decides whether the card keeps its last numbers:
// NotReady and Transient keep them and add a line of explanation, Failed clears them.

export const NOT_READY = "NotReady"; // not installed, not signed in, or expired — the
// message is shown verbatim, so it has to be an instruction the user can act on
export const TRANSIENT = "Transient"; // rate limited, timed out, dropped; next poll recovers
export const FAILED = "Failed"; // unexpected response shape or status code

export class CollectError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }

  /** A stale number beats a column of red while the provider is only temporarily out. */
  get keepsLastGood() {
    return this.kind === NOT_READY || this.kind === TRANSIENT;
  }
}

export const notReady = (message) => new CollectError(NOT_READY, message);
export const transient = (message) => new CollectError(TRANSIENT, message);
export const failed = (message) => new CollectError(FAILED, message);

/** Anything thrown that is not ours (a bug, a runtime error) reads as a hard failure. */
export function asCollectError(err) {
  // Duck-typed on purpose: the backend runtime can load this module twice under two
  // path spellings (../lib/errors.js vs ./errors.js), and then instanceof fails for
  // a perfectly good CollectError, silently downgrading NotReady to Failed.
  if (err && typeof err.kind === "string" && typeof err.message === "string") {
    if (!("keepsLastGood" in err)) {
      Object.defineProperty(err, "keepsLastGood", { get: () => err.kind === NOT_READY || err.kind === TRANSIENT });
    }
    return err;
  }
  return failed(err && err.message ? err.message : String(err));
}

/** Timeouts, connection problems and 429 are temporary; any other status is hard. */
export function statusError(status, body) {
  const err =
    status === 429
      ? transient("請求太頻繁，顯示上次數字，稍後自動重試")
      : failed(`連線失敗：${status}`);
  // Kept off the card (it can be long and English) but available to diagnostics;
  // usage and billing error bodies carry reasons, never tokens.
  err.detail = typeof body === "string" ? body.slice(0, 300) : null;
  return err;
}

/** A malformed response breaks one card, not the whole poll. */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw failed(`回應格式不符：${err.message}`);
  }
}
