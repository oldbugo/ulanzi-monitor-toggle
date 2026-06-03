import assert from "node:assert/strict";
import test from "node:test";

import {
  generateAllowanceIconSvg,
  manualSnapshotFromSettings,
  normalizeClaudeOauthUsageSnapshot,
  normalizeCodexUsageSnapshot,
  normalizeAiAllowanceSettings,
  rollResetAt,
  snapshotLevel,
  staleSnapshotFromCache
} from "../com.ulanzi.utilitysuite.ulanziPlugin/plugin/src/utilities/aiAllowance/index.js";

test("normalizes allowance settings", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "bad",
    window: "weekly",
    source: "manual",
    warningPercent: "20",
    criticalPercent: "30",
    remainingPercent: "105",
    resetAt: "2026-06-03T10:00:00+10:00"
  });

  assert.equal(settings.provider, "codex");
  assert.equal(settings.window, "weekly");
  assert.equal(settings.source, "manual");
  assert.equal(settings.warningPercent, 30);
  assert.equal(settings.criticalPercent, 30);
  assert.equal(settings.remainingPercent, 100);
  assert.equal(settings.resetAt, "2026-06-03T00:00:00.000Z");
});

test("rolls expired five-hour reset windows forward", () => {
  const resetAt = rollResetAt(
    "2026-06-03T00:00:00.000Z",
    "five_hour",
    new Date("2026-06-03T11:30:00.000Z")
  );

  assert.equal(resetAt, "2026-06-03T15:00:00.000Z");
});

test("manual snapshot resets remaining to 100 after elapsed window", () => {
  const settings = normalizeAiAllowanceSettings({
    source: "manual",
    remainingPercent: 12,
    resetAt: "2026-06-03T00:00:00.000Z"
  });
  const snapshot = manualSnapshotFromSettings(settings, new Date("2026-06-03T06:00:00.000Z"));

  assert.equal(snapshot.remainingPercent, 100);
  assert.equal(snapshot.level, "ok");
  assert.equal(snapshot.resetAt, "2026-06-03T10:00:00.000Z");
});

test("snapshot level respects warning and critical thresholds", () => {
  const settings = normalizeAiAllowanceSettings({
    warningPercent: 25,
    criticalPercent: 10
  });

  assert.equal(snapshotLevel({ remainingPercent: 26 }, settings), "ok");
  assert.equal(snapshotLevel({ remainingPercent: 25 }, settings), "warning");
  assert.equal(snapshotLevel({ remainingPercent: 10 }, settings), "critical");
  assert.equal(snapshotLevel({ remainingPercent: null }, settings), "unknown");
});

test("stale cache snapshot preserves cached allowance state", () => {
  const settings = normalizeAiAllowanceSettings({
    source: "auto_status",
    remainingPercent: 50
  });
  const stale = staleSnapshotFromCache({
    snapshot: {
      source: "auto_status",
      remainingPercent: 18,
      resetAt: "2026-06-03T12:00:00.000Z",
      fetchedAt: "2026-06-03T10:00:00.000Z",
      cliVersion: "fixture"
    }
  }, settings, new Date("2026-06-03T11:00:00.000Z"));

  assert.equal(stale.status, "stale");
  assert.equal(stale.remainingPercent, 18);
  assert.equal(stale.level, "warning");
  assert.equal(stale.resetAt, "2026-06-03T12:00:00.000Z");
});

test("unknown status rendering uses an explicit unknown marker", () => {
  const settings = normalizeAiAllowanceSettings({});
  const svg = generateAllowanceIconSvg({
    provider: "codex",
    window: "five_hour",
    source: "auto_status",
    status: "unknown",
    level: "unknown",
    remainingPercent: null,
    resetAt: null
  }, settings, new Date("2026-06-03T10:00:00.000Z"));

  assert.match(svg, />\?<\/text>/);
  assert.match(svg, />UNKNOWN<\/text>/);
});

test("normalizes Codex ChatGPT usage response for selected window", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "codex",
    window: "weekly",
    warningPercent: 30,
    criticalPercent: 10
  });
  const snapshot = normalizeCodexUsageSnapshot(settings, {
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 27,
        limit_window_seconds: 18000,
        reset_at: 1780492520
      },
      secondary_window: {
        used_percent: 37,
        limit_window_seconds: 604800,
        reset_at: 1780917230
      }
    },
    credits: {
      has_credits: false,
      unlimited: false,
      balance: "0"
    }
  }, new Date("2026-06-03T08:44:27.847Z"));

  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.sourceDetail, "codex_chatgpt_auth");
  assert.equal(snapshot.usedPercent, 37);
  assert.equal(snapshot.remainingPercent, 63);
  assert.equal(snapshot.level, "ok");
  assert.equal(snapshot.resetAt, "2026-06-08T11:13:50.000Z");
});

test("normalizes Claude OAuth usage response for selected window", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "claude",
    window: "five_hour"
  });
  const snapshot = normalizeClaudeOauthUsageSnapshot(settings, {
    five_hour: {
      utilization: 82.3,
      resets_at: "2026-06-03T12:00:00+00:00"
    },
    seven_day: {
      utilization: 14,
      resets_at: "2026-06-09T12:00:00+00:00"
    }
  }, new Date("2026-06-03T08:44:27.847Z"));

  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.sourceDetail, "claude_oauth");
  assert.equal(snapshot.usedPercent, 82);
  assert.equal(snapshot.remainingPercent, 18);
  assert.equal(snapshot.level, "warning");
  assert.equal(snapshot.resetAt, "2026-06-03T12:00:00.000Z");
});
