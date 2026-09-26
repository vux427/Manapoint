// Token rules, ported from the Rust *_token modules: when to refresh, how a refresh
// reply folds in, and that write-back never disturbs anything else in the file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as ag from "../src/providers/antigravity_token.js";
import * as claude from "../src/providers/claude_token.js";
import * as codex from "../src/providers/codex_token.js";
import * as xai from "../src/providers/xai_token.js";
import { jwtExp, parseDatetime } from "../src/lib/values.js";

const now = 1788624612000;
const min = (m) => now + m * 60_000;

function jwt(payload) {
  const b64 = (s) => Buffer.from(s).toString("base64url");
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify(payload))}.sig`;
}

describe("expiry skew (Claude, xAI)", () => {
  for (const [name, mod] of [["claude", claude], ["xai", xai]]) {
    it(`${name}: refreshes within five minutes, or with no expiry`, () => {
      const e = (expiresMs, access = "a") => ({ access, refresh: "r", expiresMs });
      assert.equal(mod.needsRefresh(e(min(120)), now), false);
      assert.equal(mod.needsRefresh(e(min(-60)), now), true);
      assert.equal(mod.needsRefresh(e(min(4)), now), true);
      assert.equal(mod.needsRefresh(e(min(6)), now), false);
      assert.equal(mod.needsRefresh(e(0), now), true);
      assert.equal(mod.needsRefresh(e(min(120), ""), now), true);
    });
  }
});

describe("Claude token", () => {
  it("rotates tokens; keeps old refresh and expiry when absent", () => {
    const old = { access: "a", refresh: "old-r", expiresMs: min(30) };
    const rotated = claude.applyRefresh(old, `{"access_token":"new","refresh_token":"new-r","expires_in":7200}`, now);
    assert.deepEqual(rotated, { access: "new", refresh: "new-r", expiresMs: min(120) });
    const partial = claude.applyRefresh(old, `{"access_token":"new"}`, now);
    assert.equal(partial.refresh, "old-r");
    assert.equal(partial.expiresMs, min(30));
  });

  it("a reply without access_token is transient", () => {
    assert.throws(
      () => claude.applyRefresh({ access: "a", refresh: "r", expiresMs: 0 }, `{"refresh_token":"x"}`, now),
      (err) => err.keepsLastGood && /access_token/.test(err.message),
    );
  });

  it("merge preserves sibling metadata and drops snake_case aliases", () => {
    const original = `{"claudeAiOauth":{"accessToken":"old","refreshToken":"old-r","expiresAt":1,
      "access_token":"stale","scopes":["user:inference"],"subscriptionType":"max"},"other":1}`;
    const node = JSON.parse(claude.mergeEntry(original, { access: "new", refresh: "new-r", expiresMs: 2 })).claudeAiOauth;
    assert.equal(node.accessToken, "new");
    assert.equal(node.expiresAt, 2);
    assert.equal(node.subscriptionType, "max");
    assert.equal(node.access_token, undefined);
  });

  it("parses snake_case and rejects a blank access token", () => {
    assert.deepEqual(
      claude.parseEntry({ claudeAiOauth: { access_token: "a", refresh_token: "r", expires_at: 5 } }),
      { access: "a", refresh: "r", expiresMs: 5 },
    );
    assert.equal(claude.parseEntry({ claudeAiOauth: { accessToken: "  " } }), null);
  });

  it("sends the public client in the refresh form", () => {
    assert.deepEqual(claude.refreshForm("s"), { grant_type: "refresh_token", refresh_token: "s", client_id: claude.CLIENT_ID });
  });
});

describe("Codex token", () => {
  const entry = (access, lastRefreshMs = now) => ({ access, refresh: "r", idToken: "id", accountId: "acc", lastRefreshMs });

  it("reads exp from the JWT payload, rejects malformed tokens", () => {
    assert.equal(jwtExp(jwt({ exp: 1788628212 })), 1788628212);
    assert.equal(jwtExp("not-a-jwt"), null);
    assert.equal(jwtExp("a.b.c.d"), null);
    assert.equal(jwtExp(jwt({ no_exp: 1 })), null);
  });

  it("refreshes a JWT within the skew, or a stale session without one", () => {
    const soon = Math.floor(min(4) / 1000);
    const later = Math.floor(min(6) / 1000);
    assert.equal(codex.needsRefresh(entry(jwt({ exp: soon })), now), true);
    assert.equal(codex.needsRefresh(entry(jwt({ exp: later })), now), false);
    assert.equal(codex.needsRefresh(entry("opaque", now - 9 * 86_400_000), now), true);
    assert.equal(codex.needsRefresh(entry("opaque", now - 2 * 86_400_000), now), false);
    assert.equal(codex.needsRefresh(entry("", null), now), true);
  });

  it("folds a reply in, keeping what it omits and stamping the time", () => {
    const u = codex.applyRefresh(entry("old"), `{"access_token":"new-a"}`, now);
    assert.deepEqual(u, { access: "new-a", refresh: "r", idToken: "id", accountId: "acc", lastRefreshMs: now });
    assert.throws(() => codex.applyRefresh(entry(""), `{}`, now), (e) => e.keepsLastGood);
  });

  it("merge only touches tokens and last_refresh", () => {
    const original = `{"auth_mode":"chatgpt","OPENAI_API_KEY":"keep-me",
      "tokens":{"id_token":"old-id","access_token":"old","refresh_token":"old-r","account_id":"acc"},
      "last_refresh":"2026-01-01T00:00:00.000Z"}`;
    const root = JSON.parse(codex.mergeEntry(original, { ...entry("new"), refresh: "new-r" }));
    assert.equal(root.OPENAI_API_KEY, "keep-me");
    assert.equal(root.tokens.access_token, "new");
    assert.equal(root.tokens.refresh_token, "new-r");
    assert.equal(parseDatetime(root.last_refresh), now);
  });
});

describe("xAI token", () => {
  it("rotates, defaults a missing expires_in to an hour", () => {
    const old = { type: "oauth", access: "a", refresh: "old-r", expiresMs: now };
    assert.equal(xai.applyRefresh(old, `{"access_token":"n","refresh_token":"n-r","expires_in":7200}`, now).expiresMs, min(120));
    const d = xai.applyRefresh(old, `{"access_token":"n"}`, now);
    assert.equal(d.refresh, "old-r");
    assert.equal(d.expiresMs, min(60));
  });

  it("merge only touches the xai node", () => {
    const original = `{"opencode-go":{"key":"sk-keep"},"xai":{"type":"oauth","access":"old","refresh":"old-r","expires":1}}`;
    const root = JSON.parse(xai.mergeEntry(original, { type: "oauth", access: "new", refresh: "new-r", expiresMs: 2 }));
    assert.equal(root["opencode-go"].key, "sk-keep");
    assert.deepEqual(root.xai, { type: "oauth", access: "new", refresh: "new-r", expires: 2 });
  });

  it("requires an xai section with a real access token", () => {
    assert.equal(xai.parseEntry({ "opencode-go": { key: "k" } }), null);
    assert.equal(xai.parseEntry({ xai: { access: "  " } }), null);
  });
});

describe("Antigravity token", () => {
  const REAL_BLOB = `{"token":{"access_token":"ya29.token","token_type":"Bearer",
    "refresh_token":"1//refresh","expiry":"2026-09-09T00:37:23.7530207+08:00"},"auth_method":"consumer"}`;
  const bytes = (s) => new TextEncoder().encode(s);

  it("parses the real blob, a BOM, and the flat older shape", () => {
    const e = ag.parseEntry(bytes(REAL_BLOB));
    assert.equal(e.access, "ya29.token");
    assert.equal(e.refresh, "1//refresh");
    assert.equal(e.expiresMs, Date.UTC(2026, 8, 8, 16, 37, 23, 753));
    assert.ok(ag.parseEntry(bytes("﻿" + REAL_BLOB)));
    const flat = ag.parseEntry(bytes(`{"access_token":"flat","refresh_token":"fr"}`));
    assert.equal(flat.access, "flat");
    assert.equal(flat.expiresMs, null);
  });

  it("rejects blobs without an access token", () => {
    assert.equal(ag.parseEntry(bytes(`{"token":{"refresh_token":"r"}}`)), null);
    assert.equal(ag.parseEntry(bytes(`{"token":{"access_token":"  "}}`)), null);
    assert.equal(ag.parseEntry(bytes("not json")), null);
  });

  it("refreshes within the skew or with an unknown expiry", () => {
    const e = (m) => ({ access: "a", refresh: "r", expiresMs: m === null ? null : min(m) });
    assert.equal(ag.needsRefresh(e(120), now), false);
    assert.equal(ag.needsRefresh(e(4), now), true);
    assert.equal(ag.needsRefresh(e(6), now), false);
    assert.equal(ag.needsRefresh(e(null), now), true);
  });

  it("sends the public installed-app client", () => {
    const f = ag.refreshForm("s");
    assert.equal(f.client_id, ag.CLIENT_ID);
    assert.ok(f.client_secret.startsWith("GOCSPX-"));
    assert.equal(f.grant_type, "refresh_token");
  });

  it("parses a refresh reply, defaulting a missing expiry", () => {
    assert.deepEqual(ag.parseRefresh(`{"access_token":"fresh","expires_in":1800}`, "r", now),
      { access: "fresh", expiresMs: now + 1_800_000, mintedFrom: "r" });
    assert.equal(ag.parseRefresh(`{"access_token":"fresh"}`, "r", now).expiresMs, now + 3_600_000);
    assert.throws(() => ag.parseRefresh(`{"expires_in":1800}`, "r", now), (e) => e.keepsLastGood);
  });
});
