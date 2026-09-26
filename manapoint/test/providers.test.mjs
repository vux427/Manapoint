// Parser tests, ported from the Rust collectors. The fixtures are real responses
// (dates noted) with account fields stripped, so a shape change shows up here first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as antigravity from "../src/providers/antigravity.js";
import * as claude from "../src/providers/claude.js";
import * as codex from "../src/providers/codex.js";
import * as grok from "../src/providers/grok.js";
import * as opencodeGo from "../src/providers/opencode_go.js";

const kinds = (u) => u.windows.map((w) => w.kind);
const at = Date.UTC(2026, 8, 5, 9, 0, 0);

describe("opencode Go", () => {
  const REAL = `{"usage":{
    "rolling":{"status":"ok","percent":0,"resetsAt":"2026-09-05T13:38:32.096Z"},
    "weekly":{"status":"ok","percent":15,"resetsAt":"2026-09-07T00:00:00.096Z"},
    "monthly":{"status":"ok","percent":24,"resetsAt":"2026-09-10T06:10:40.096Z"}}}`;

  it("returns three windows in order with percents", () => {
    const u = opencodeGo.parse(REAL, at);
    assert.deepEqual(kinds(u), ["Rolling", "Weekly", "Monthly"]);
    assert.deepEqual(u.windows.map((w) => w.percent), [0, 15, 24]);
    assert.equal(u.windows[1].resetsAt, "2026-09-07T00:00:00.096Z");
  });

  it("fails when usage or a window is missing", () => {
    assert.throws(() => opencodeGo.parse(`{"other":{}}`, at), /usage/);
    assert.throws(
      () => opencodeGo.parse(`{"usage":{"rolling":{"percent":0,"resetsAt":"2026-09-05T13:38:32Z"},
        "weekly":{"percent":15,"resetsAt":"2026-09-07T00:00:00Z"}}}`, at),
      /monthly/,
    );
    assert.throws(() => opencodeGo.parse("not json", at));
  });
});

describe("Claude", () => {
  const REAL = `{
    "five_hour":{"utilization":5.0,"resets_at":"2026-09-05T20:00:00.469547+08:00","limit_dollars":null},
    "seven_day":{"utilization":1.0,"resets_at":"2026-09-11T09:00:00.469575+08:00"},
    "seven_day_opus":null,"nimbus_quill":{"utilization":0.0,"resets_at":null}}`;

  it("returns five-hour then weekly, instant kept across the offset", () => {
    const u = claude.parse(REAL, at);
    assert.deepEqual(kinds(u), ["Rolling", "Weekly"]);
    assert.deepEqual(u.windows.map((w) => w.percent), [5, 1]);
    assert.equal(u.windows[0].resetsAt, "2026-09-05T12:00:00.469Z");
  });

  it("allows a null reset, rejects missing or null windows", () => {
    const u = claude.parse(`{"five_hour":{"utilization":2.5,"resets_at":null},"seven_day":{"utilization":0,"resets_at":null}}`, at);
    assert.equal(u.windows[0].resetsAt, null);
    assert.throws(() => claude.parse(`{"five_hour":{"utilization":5,"resets_at":null}}`, at), /seven_day/);
    assert.throws(() => claude.parse(`{"five_hour":null,"seven_day":null}`, at));
  });
});

describe("Codex", () => {
  const REAL = `{"plan_type":"team","rate_limit":{"allowed":true,
    "primary_window":{"used_percent":0,"limit_window_seconds":18000,"reset_at":1788617477},
    "secondary_window":{"used_percent":98,"limit_window_seconds":604800,"reset_at":1788756101}}}`;

  it("maps windows by duration and converts unix resets", () => {
    const u = codex.parse(REAL, at);
    assert.deepEqual(kinds(u), ["Rolling", "Weekly"]);
    assert.equal(u.windows[1].percent, 98);
    assert.equal(u.windows[1].resetsAt, new Date(1788756101 * 1000).toISOString());
  });

  it("ignores field order when classifying", () => {
    const swapped = `{"rate_limit":{
      "primary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_at":1788756101},
      "secondary_window":{"used_percent":20,"limit_window_seconds":18000,"reset_at":1788617477}}}`;
    assert.deepEqual(kinds(codex.parse(swapped, at)), ["Weekly", "Rolling"]);
  });

  it("classifies window lengths", () => {
    assert.equal(codex.kindFor(18_000), "Rolling");
    assert.equal(codex.kindFor(86_400), "Rolling");
    assert.equal(codex.kindFor(604_800), "Weekly");
    assert.equal(codex.kindFor(2_592_000), "Monthly");
  });

  it("skips missing or unreadable windows and notes an account with none", () => {
    const partial = `{"rate_limit":{"primary_window":{"limit_window_seconds":18000},
      "secondary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_at":1788756101}}}`;
    assert.deepEqual(kinds(codex.parse(partial, at)), ["Weekly"]);
    const none = codex.parse(`{"rate_limit":{"primary_window":null,"secondary_window":null}}`, at);
    assert.equal(none.windows.length, 0);
    assert.equal(none.note, "此帳號沒有訂閱額度");
    assert.throws(() => codex.parse(`{"plan_type":"team"}`, at), /rate_limit/);
  });
});

describe("Grok", () => {
  it("maps the credit percent to WEEK, preferring currentPeriod.end", () => {
    const u = grok.parse(`{"config":{"currentPeriod":{"end":"2026-09-12T00:00:00+00:00"},
      "creditUsagePercent":35.5,"billingPeriodEnd":"2026-10-01T00:00:00+00:00"}}`, at);
    assert.deepEqual(kinds(u), ["Weekly"]);
    assert.equal(u.windows[0].percent, 35.5);
    assert.equal(u.windows[0].resetsAt, "2026-09-12T00:00:00.000Z");
  });

  it("keeps MONTH when a limit is set, and shows both signals WEEK first", () => {
    const monthly = grok.parse(`{"config":{"monthlyLimit":{"val":60},"used":{"val":15}}}`, at);
    assert.deepEqual(kinds(monthly), ["Monthly"]);
    assert.equal(monthly.windows[0].percent, 25);
    const both = grok.parse(`{"config":{"creditUsagePercent":35.5,"monthlyLimit":{"val":60},"used":{"val":15}}}`, at);
    assert.deepEqual(kinds(both), ["Weekly", "Monthly"]);
  });

  it("reads productUsage when the top-level percent is missing; top level wins", () => {
    const product = grok.parse(`{"config":{"productUsage":[{"product":"GrokBuild","usagePercent":45.0},{"product":"GrokChat"}]}}`, at);
    assert.equal(product.windows[0].percent, 45);
    const top = grok.parse(`{"config":{"creditUsagePercent":75.0,"productUsage":[{"usagePercent":45.0}]}}`, at);
    assert.equal(top.windows[0].percent, 75);
  });

  const UNIFIED = (cap) => `{"config":{
    "currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-09-17T08:41:03.094066+00:00"},
    "onDemandCap":{"val":${cap}},"onDemandUsed":{"val":0},"isUnifiedBillingUser":true,"prepaidBalance":{"val":0}}}`;

  it("reads an all-zero unified weekly bill as 0% used", () => {
    const u = grok.parse(UNIFIED(0), at);
    assert.deepEqual(kinds(u), ["Weekly"]);
    assert.equal(u.windows[0].percent, 0);
    assert.equal(u.note, "本週期尚無用量");
  });

  it("never synthesises 0% when a non-zero amount lacks a percentage", () => {
    const u = grok.parse(UNIFIED(100), at);
    assert.equal(u.windows.length, 0);
    assert.equal(u.note, "SuperGrok 統一帳單，帳務端未回傳用量百分比（下次重置 2026-09-17）");
  });

  it("explains accounts without a usable signal", () => {
    assert.equal(grok.parse(`{"config":{"onDemandCap":{"val":5}}}`, at).note, "此帳號沒有 Grok 訂閱額度");
    assert.equal(
      grok.parse(`{"config":{"monthlyLimit":{"val":0},"used":{"val":3.5}}}`, at).note,
      "本月已用 $3.5，此帳號未設額度上限",
    );
    assert.throws(() => grok.parse(`{"foo":1}`, at), /config/);
  });

  it("trims amounts", () => {
    assert.equal(grok.trimAmount(3), "3");
    assert.equal(grok.trimAmount(3.5), "3.5");
    assert.equal(grok.trimAmount(3.456), "3.46");
  });
});

describe("Antigravity", () => {
  const REAL = `{"groups":[
    {"buckets":[
      {"bucketId":"gemini-weekly","resetTime":"2026-09-15T16:02:03Z","remainingFraction":1},
      {"bucketId":"gemini-5h","resetTime":"2026-09-08T21:02:03Z","remainingFraction":1}]},
    {"buckets":[
      {"bucketId":"3p-weekly","resetTime":"2026-09-15T15:58:51Z","remainingFraction":0.93986666},
      {"bucketId":"3p-5h","resetTime":"2026-09-08T20:58:51Z","remainingFraction":0.8302704}]}]}`;
  const { gemini, thirdParty } = antigravity.POOLS;

  it("matches buckets by id and converts remaining to used", () => {
    const g = antigravity.parse(gemini, REAL, at);
    assert.deepEqual(kinds(g), ["Rolling", "Weekly"]);
    assert.deepEqual(g.windows.map((w) => w.percent), [0, 0]);
    assert.equal(g.windows[0].resetsAt, "2026-09-08T21:02:03.000Z");
    const p = antigravity.parse(thirdParty, REAL, at);
    assert.ok(Math.abs(p.windows[0].percent - 16.97296) < 1e-4);
    assert.ok(Math.abs(p.windows[1].percent - 6.013334) < 1e-4);
  });

  it("skips a missing bucket, notes a missing pool, accepts the wrapped shape", () => {
    const one = antigravity.parse(gemini, `{"groups":[{"buckets":[{"bucketId":"gemini-weekly","remainingFraction":0.5}]}]}`, at);
    assert.deepEqual(kinds(one), ["Weekly"]);
    assert.equal(one.windows[0].percent, 50);
    const none = antigravity.parse(thirdParty, `{"groups":[{"buckets":[{"bucketId":"gemini-5h","remainingFraction":1}]}]}`, at);
    assert.ok(none.note);
    const wrapped = antigravity.parse(gemini, `{"response":{"groups":[{"buckets":[{"bucketId":"gemini-5h","remainingFraction":0.4}]}]}}`, at);
    assert.ok(Math.abs(wrapped.windows[0].percent - 60) < 1e-9);
  });

  it("clamps, and fails on shape changes", () => {
    const c = antigravity.parse(gemini, `{"groups":[{"buckets":[
      {"bucketId":"gemini-5h","remainingFraction":1.4},{"bucketId":"gemini-weekly","remainingFraction":-0.2}]}]}`, at);
    assert.deepEqual(c.windows.map((w) => w.percent), [0, 100]);
    assert.throws(() => antigravity.parse(gemini, `{"description":"x"}`, at), /groups/);
    assert.throws(() => antigravity.parse(gemini, `{"groups":[{"buckets":[{"bucketId":"gemini-5h"}]}]}`, at), /remainingFraction/);
  });
});
