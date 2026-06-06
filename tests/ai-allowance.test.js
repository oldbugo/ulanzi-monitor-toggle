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
  mergeClaudeOauthRefreshCredentials,
  normalizeClaudeOauthUsageSnapshot,
  normalizeCodexUsageSnapshot,
  normalizeAiAllowanceSettings,
  notConnectedSnapshotFromCache,
  shouldUseTransitionAnimation,
  snapshotLevel,
  visualBandFromSnapshot
} from "../com.ulanzi.utilitysuite.ulanziPlugin/plugin/src/utilities/aiAllowance/index.js";
import {
  DEV_VISUAL_BANDS,
  createDevAllowanceSnapshot,
  sampleRemainingForDevBand
} from "../com.ulanzi.utilitysuite.ulanziPlugin/plugin/src/utilities/aiAllowanceDev/index.js";

test("normalizes allowance settings", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "bad",
    window: "weekly",
    source: "legacy_source",
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
  assert.equal(settings.source, "auto_status");
  assert.equal(settings.warningPercent, 30);
  assert.equal(settings.criticalPercent, 30);
  assert.equal(settings.visualFullPercent, 90);
  assert.equal(settings.visualHealthyPercent, 70);
  assert.equal(settings.visualCautionPercent, 40);
  assert.equal(settings.visualWarningPercent, 20);
  assert.equal(settings.visualCriticalPercent, 19);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, "remainingPercent"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, "resetAt"), false);
});

test("migrates legacy visual threshold defaults", () => {
  const settings = normalizeAiAllowanceSettings({
    visualFullPercent: 76,
    visualHealthyPercent: 51,
    visualCautionPercent: 26,
    visualWarningPercent: 11,
    visualCriticalPercent: 10
  });

  assert.equal(settings.visualFullPercent, 80);
  assert.equal(settings.visualHealthyPercent, 65);
  assert.equal(settings.visualCautionPercent, 40);
  assert.equal(settings.visualWarningPercent, 20);
  assert.equal(settings.visualCriticalPercent, 19);
});

test("legacy source settings are normalized to auto status", () => {
  const settings = normalizeAiAllowanceSettings({
    source: "legacy_source",
    remainingPercent: 12,
    resetAt: "2026-06-03T00:00:00.000Z"
  });

  assert.equal(settings.source, "auto_status");
  assert.equal(Object.prototype.hasOwnProperty.call(settings, "remainingPercent"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, "resetAt"), false);
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
    [80, "full"],
    [79, "healthy"],
    [65, "healthy"],
    [64, "caution"],
    [40, "caution"],
    [39, "warning"],
    [20, "warning"],
    [19, "critical"],
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

test("dev preview boundary samples map to each visual band", () => {
  const settings = normalizeAiAllowanceSettings({});
  const expectedRemaining = {
    full: 100,
    healthy: 79,
    caution: 64,
    warning: 39,
    critical: 19
  };

  for (const band of DEV_VISUAL_BANDS) {
    const remainingPercent = sampleRemainingForDevBand(band, settings, "boundary");
    assert.equal(remainingPercent, expectedRemaining[band]);
    assert.equal(visualBandFromSnapshot({ remainingPercent }, settings), band);
  }
});

test("dev preview midpoint samples map to custom visual bands", () => {
  const settings = normalizeAiAllowanceSettings({
    visualFullPercent: 90,
    visualHealthyPercent: 70,
    visualCautionPercent: 40,
    visualWarningPercent: 10,
    visualCriticalPercent: 5
  });

  for (const band of DEV_VISUAL_BANDS) {
    const remainingPercent = sampleRemainingForDevBand(band, settings, "midpoint");
    assert.equal(visualBandFromSnapshot({ remainingPercent }, settings), band);
  }
});

test("dev preview snapshot renders like live provider usage", () => {
  const settings = {
    ...normalizeAiAllowanceSettings({
      provider: "claude",
      window: "weekly",
      visualFullPercent: 80,
      visualHealthyPercent: 65,
      visualCautionPercent: 40,
      visualWarningPercent: 20,
      visualCriticalPercent: 19
    }),
    sampleMode: "boundary"
  };
  const snapshot = createDevAllowanceSnapshot("warning", settings, new Date("2026-06-04T00:00:00.000Z"));
  const svg = generateAllowanceIconSvg(snapshot, settings, new Date("2026-06-04T00:00:00.000Z"));

  assert.equal(snapshot.source, "auto_status");
  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.remainingPercent, 39);
  assert.equal(visualBandFromSnapshot(snapshot, settings), "warning");
  assert.match(svg, /CLAUDE/);
  assert.match(svg, /39%/);
  assert.match(svg, /LIVE/);
});

test("cache fallback renders not connected without cached allowance percentage", () => {
  const settings = normalizeAiAllowanceSettings({
    source: "auto_status"
  });
  const snapshot = notConnectedSnapshotFromCache({
    snapshot: {
      source: "auto_status",
      remainingPercent: 18,
      resetAt: "2026-06-03T12:00:00.000Z",
      fetchedAt: "2026-06-03T10:00:00.000Z",
      cliVersion: "fixture"
    }
  }, settings, new Date("2026-06-03T11:00:00.000Z"));

  assert.equal(snapshot.status, "not_connected");
  assert.equal(snapshot.remainingPercent, null);
  assert.equal(snapshot.level, "unknown");
  assert.equal(snapshot.resetAt, null);
  assert.equal(snapshot.cachedRemainingPercent, 18);
  assert.equal(snapshot.cachedResetAt, "2026-06-03T12:00:00.000Z");
});

test("cache fallback ignores non-live or mismatched cached snapshots", () => {
  const settings = normalizeAiAllowanceSettings({
    provider: "claude",
    window: "weekly"
  });

  assert.equal(notConnectedSnapshotFromCache({
    snapshot: {
      provider: "claude",
      window: "weekly",
      status: "not_connected",
      fetchedAt: "2026-06-03T10:00:00.000Z"
    }
  }, settings), null);

  assert.equal(notConnectedSnapshotFromCache({
    snapshot: {
      provider: "codex",
      window: "weekly",
      status: "live",
      remainingPercent: 50,
      fetchedAt: "2026-06-03T10:00:00.000Z"
    }
  }, settings), null);
});

test("not connected rendering uses a grey explicit marker", () => {
  const settings = normalizeAiAllowanceSettings({});
  const svg = generateAllowanceIconSvg({
    provider: "codex",
    window: "five_hour",
    source: "auto_status",
    status: "not_connected",
    level: "unknown",
    remainingPercent: null,
    resetAt: null
  }, settings, new Date("2026-06-03T10:00:00.000Z"));

  assert.match(svg, /fill="#334155"/);
  assert.match(svg, />--<\/text>/);
  assert.match(svg, />NOT CONN<\/text>/);
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

test("shared SVG background asset is used when provider asset is absent", () => {
  const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-allowance-background-"));
  try {
    const backgroundDir = path.join(resourceRoot, "backgrounds", "shared");
    fs.mkdirSync(backgroundDir, { recursive: true });
    fs.writeFileSync(path.join(backgroundDir, "caution.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#654321"/></svg>');
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
    assert.match(svg, /fill="#654321"/);
  } finally {
    fs.rmSync(resourceRoot, { recursive: true, force: true });
  }
});

test("raster static backgrounds are ignored for generated overlay icons", () => {
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

    assert.doesNotMatch(svg, /href="data:image\/png;base64,/);
    assert.match(svg, /fill="#854d0e"/);
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
    allowanceSharedBackgroundAssetPath("healthy"),
    "resources/actions/ai-allowance/backgrounds/shared/healthy.svg"
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
