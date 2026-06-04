import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowanceBackgroundAssetPath,
  allowanceSharedBackgroundAssetPath,
  allowanceTransitionAssetPath,
  generateAllowanceIconSvg,
  manualSnapshotFromSettings,
  mergeClaudeOauthRefreshCredentials,
  normalizeClaudeOauthUsageSnapshot,
  normalizeCodexUsageSnapshot,
  normalizeAiAllowanceSettings,
  rollResetAt,
  shouldUseTransitionAnimation,
  snapshotLevel,
  staleSnapshotFromCache,
  visualBandFromSnapshot
} from "../com.ulanzi.utilitysuite.ulanziPlugin/plugin/src/utilities/aiAllowance/index.js";

test("normalizes allowance settings", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "bad",
    window: "weekly",
    source: "manual",
    warningPercent: "20",
    criticalPercent: "30",
    visualFullPercent: "90",
    visualHealthyPercent: "70",
    visualCautionPercent: "40",
    visualWarningPercent: "20",
    visualCriticalPercent: "50",
    remainingPercent: "105",
    resetAt: "2026-06-03T10:00:00+10:00"
  });

  assert.equal(settings.provider, "codex");
  assert.equal(settings.window, "weekly");
  assert.equal(settings.source, "manual");
  assert.equal(settings.warningPercent, 30);
  assert.equal(settings.criticalPercent, 30);
  assert.equal(settings.visualFullPercent, 90);
  assert.equal(settings.visualHealthyPercent, 70);
  assert.equal(settings.visualCautionPercent, 40);
  assert.equal(settings.visualWarningPercent, 20);
  assert.equal(settings.visualCriticalPercent, 19);
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

test("visual bands map remaining allowance boundaries", () => {
  const settings = normalizeAiAllowanceSettings({});
  const cases = [
    [100, "full"],
    [76, "full"],
    [75, "healthy"],
    [51, "healthy"],
    [50, "caution"],
    [26, "caution"],
    [25, "warning"],
    [11, "warning"],
    [10, "critical"],
    [0, "critical"],
    [null, "unknown"]
  ];

  for (const [remainingPercent, expectedBand] of cases) {
    assert.equal(visualBandFromSnapshot({ remainingPercent }, settings), expectedBand);
  }
});

test("visual bands honor custom thresholds", () => {
  const settings = normalizeAiAllowanceSettings({
    visualFullPercent: 90,
    visualHealthyPercent: 70,
    visualCautionPercent: 40,
    visualWarningPercent: 20,
    visualCriticalPercent: 5
  });

  assert.equal(visualBandFromSnapshot({ remainingPercent: 90 }, settings), "full");
  assert.equal(visualBandFromSnapshot({ remainingPercent: 89 }, settings), "healthy");
  assert.equal(visualBandFromSnapshot({ remainingPercent: 69 }, settings), "caution");
  assert.equal(visualBandFromSnapshot({ remainingPercent: 39 }, settings), "warning");
  assert.equal(visualBandFromSnapshot({ remainingPercent: 6 }, settings), "warning");
  assert.equal(visualBandFromSnapshot({ remainingPercent: 5 }, settings), "critical");
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

test("missing static background asset falls back to generated band color", () => {
  const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-allowance-background-"));
  try {
    const settings = normalizeAiAllowanceSettings({ provider: "codex" });
    const svg = generateAllowanceIconSvg({
      provider: "codex",
      window: "five_hour",
      source: "auto_status",
      status: "live",
      level: "ok",
      remainingPercent: 90,
      resetAt: null
    }, settings, new Date("2026-06-03T10:00:00.000Z"), { resourceRoot });

    assert.match(svg, /fill="#0f766e"/);
    assert.match(svg, />90%<\/text>/);
  } finally {
    fs.rmSync(resourceRoot, { recursive: true, force: true });
  }
});

test("provider static background asset is used when present", () => {
  const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-allowance-background-"));
  try {
    const backgroundDir = path.join(resourceRoot, "backgrounds", "claude");
    fs.mkdirSync(backgroundDir, { recursive: true });
    fs.writeFileSync(path.join(backgroundDir, "warning.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#123456"/></svg>');
    const settings = normalizeAiAllowanceSettings({ provider: "claude" });
    const svg = generateAllowanceIconSvg({
      provider: "claude",
      window: "five_hour",
      source: "auto_status",
      status: "live",
      level: "warning",
      remainingPercent: 20,
      resetAt: null
    }, settings, new Date("2026-06-03T10:00:00.000Z"), { resourceRoot });

    assert.match(svg, /data-background-provider="claude"/);
    assert.match(svg, /fill="#123456"/);
  } finally {
    fs.rmSync(resourceRoot, { recursive: true, force: true });
  }
});

test("shared raster background asset is embedded when provider asset is absent", () => {
  const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-allowance-background-"));
  try {
    const backgroundDir = path.join(resourceRoot, "backgrounds", "shared");
    fs.mkdirSync(backgroundDir, { recursive: true });
    fs.writeFileSync(path.join(backgroundDir, "caution.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const settings = normalizeAiAllowanceSettings({ provider: "codex" });
    const svg = generateAllowanceIconSvg({
      provider: "codex",
      window: "five_hour",
      source: "auto_status",
      status: "live",
      level: "ok",
      remainingPercent: 40,
      resetAt: null
    }, settings, new Date("2026-06-03T10:00:00.000Z"), { resourceRoot });

    assert.match(svg, /data-background-provider="shared"/);
    assert.match(svg, /href="data:image\/png;base64,/);
    assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
  } finally {
    fs.rmSync(resourceRoot, { recursive: true, force: true });
  }
});

test("transition animation only triggers on known band changes with GIF support", () => {
  const settings = normalizeAiAllowanceSettings({ animation: "transition" });
  const api = { setGifPathIcon() {} };

  assert.equal(shouldUseTransitionAnimation("healthy", "caution", { remainingPercent: 50 }, settings, true, api), true);
  assert.equal(shouldUseTransitionAnimation("caution", "caution", { remainingPercent: 40 }, settings, true, api), false);
  assert.equal(shouldUseTransitionAnimation("healthy", "warning", { remainingPercent: 20 }, settings, false, api), false);
  assert.equal(shouldUseTransitionAnimation("healthy", "warning", { remainingPercent: null }, settings, true, api), false);
  assert.equal(shouldUseTransitionAnimation("healthy", "warning", { remainingPercent: 20 }, normalizeAiAllowanceSettings({ animation: "off" }), true, api), false);
  assert.equal(shouldUseTransitionAnimation("healthy", "warning", { remainingPercent: 20 }, settings, true, {}), false);
});

test("asset path helpers use provider-specific contract paths", () => {
  assert.equal(
    allowanceBackgroundAssetPath("claude", "warning"),
    "resources/actions/ai-allowance/backgrounds/claude/warning.svg"
  );
  assert.equal(
    allowanceBackgroundAssetPath("codex", "full", "png"),
    "resources/actions/ai-allowance/backgrounds/codex/full.png"
  );
  assert.equal(
    allowanceSharedBackgroundAssetPath("healthy", "webp"),
    "resources/actions/ai-allowance/backgrounds/shared/healthy.webp"
  );
  assert.equal(
    allowanceTransitionAssetPath("codex", "critical"),
    "resources/actions/ai-allowance/transitions/codex/critical.gif"
  );
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
  assert.match(snapshot.message, /63% remaining; 37% used/);
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
  assert.match(snapshot.message, /18% remaining; 82% used/);
});

test("Claude display percentage renders remaining allowance, not utilization", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "claude",
    window: "five_hour"
  });
  const snapshot = normalizeClaudeOauthUsageSnapshot(settings, {
    five_hour: {
      utilization: 70,
      resets_at: "2026-06-03T12:00:00+00:00"
    }
  }, new Date("2026-06-03T08:44:27.847Z"));
  const svg = generateAllowanceIconSvg(snapshot, settings, new Date("2026-06-03T08:44:27.847Z"));

  assert.equal(snapshot.usedPercent, 70);
  assert.equal(snapshot.remainingPercent, 30);
  assert.match(svg, />30%<\/text>/);
  assert.doesNotMatch(svg, />70%<\/text>/);
});

test("merges Claude OAuth refresh response into Claude Code credentials shape", () => {
  const refreshed = mergeClaudeOauthRefreshCredentials({
    claudeAiOauth: {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1780500000000,
      scopes: ["user:inference"],
      subscriptionType: "pro"
    }
  }, {
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 3600,
    scope: "user:inference user:profile"
  }, new Date("2026-06-04T01:00:00.000Z"));

  assert.equal(refreshed.claudeAiOauth.accessToken, "new-access");
  assert.equal(refreshed.claudeAiOauth.refreshToken, "new-refresh");
  assert.equal(refreshed.claudeAiOauth.expiresAt, 1780538400000);
  assert.deepEqual(refreshed.claudeAiOauth.scopes, ["user:inference", "user:profile"]);
  assert.equal(refreshed.claudeAiOauth.subscriptionType, "pro");
});
