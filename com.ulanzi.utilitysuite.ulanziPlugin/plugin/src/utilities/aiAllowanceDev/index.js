import path from "node:path";

import { contextFrom, settingsFrom } from "../../runtime/messages.js";
import { AI_ALLOWANCE_DEV_ACTION_UUID } from "../../suite/identifiers.js";
import {
  PROVIDER_LABELS,
  WINDOW_LABELS,
  generateAllowanceIconSvg,
  normalizeAiAllowanceSettings,
  snapshotLevel,
  visualBandFromSnapshot
} from "../aiAllowance/index.js";

const AI_ALLOWANCE_RESOURCE_PATH = "resources/actions/ai-allowance";
export const DEV_VISUAL_BANDS = ["full", "healthy", "caution", "warning", "critical"];
export const DEV_SAMPLE_MODES = new Set(["boundary", "midpoint"]);

function svgBase64(svg) {
  return Buffer.from(svg, "utf8").toString("base64");
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeDevSettings(raw = {}) {
  const settings = normalizeAiAllowanceSettings({
    ...raw,
    source: "auto_status",
    animation: "off"
  });

  return {
    ...settings,
    sampleMode: DEV_SAMPLE_MODES.has(raw.sampleMode) ? raw.sampleMode : "boundary"
  };
}

function midpoint(min, max) {
  return clampPercent((Number(min) + Number(max)) / 2);
}

function boundedSample(min, max, mode) {
  const lower = clampPercent(min);
  const upper = clampPercent(max);
  if (upper < lower) {
    return lower;
  }

  if (mode === "midpoint") {
    return midpoint(lower, upper);
  }

  return upper;
}

export function sampleRemainingForDevBand(band, settings, sampleMode = "boundary") {
  const normalized = normalizeAiAllowanceSettings(settings);
  const mode = DEV_SAMPLE_MODES.has(sampleMode) ? sampleMode : "boundary";

  switch (band) {
    case "full":
      return mode === "midpoint"
        ? midpoint(normalized.visualFullPercent, 100)
        : 100;
    case "healthy":
      return boundedSample(
        normalized.visualHealthyPercent,
        normalized.visualFullPercent - 1,
        mode
      );
    case "caution":
      return boundedSample(
        normalized.visualCautionPercent,
        normalized.visualHealthyPercent - 1,
        mode
      );
    case "warning":
      return boundedSample(
        normalized.visualWarningPercent,
        normalized.visualCautionPercent - 1,
        mode
      );
    case "critical":
      return mode === "midpoint"
        ? midpoint(0, normalized.visualCriticalPercent)
        : normalized.visualCriticalPercent;
    default:
      return 100;
  }
}

function resetAtForWindow(window, now = new Date()) {
  const durationMs = window === "weekly"
    ? 7 * 24 * 60 * 60 * 1000
    : 5 * 60 * 60 * 1000;
  return new Date(now.getTime() + durationMs).toISOString();
}

export function createDevAllowanceSnapshot(band, settings, now = new Date()) {
  const remainingPercent = sampleRemainingForDevBand(band, settings, settings.sampleMode);
  const snapshot = {
    provider: settings.provider,
    window: settings.window,
    source: "auto_status",
    status: "live",
    remainingPercent,
    resetAt: resetAtForWindow(settings.window, now),
    fetchedAt: now.toISOString(),
    cliVersion: "dev-preview",
    message: `Development preview for ${band} visual band at ${remainingPercent}% remaining.`
  };

  return {
    ...snapshot,
    level: snapshotLevel(snapshot, settings)
  };
}

function titleForPreview(band, settings, snapshot) {
  return `${PROVIDER_LABELS[settings.provider]} ${band} ${snapshot.remainingPercent}%`;
}

function statusForPreview(band, settings, snapshot) {
  return {
    band,
    provider: settings.provider,
    window: settings.window,
    windowLabel: WINDOW_LABELS[settings.window],
    remainingPercent: snapshot.remainingPercent,
    visualBand: visualBandFromSnapshot(snapshot, settings),
    sampleMode: settings.sampleMode,
    resetAt: snapshot.resetAt
  };
}

export function createAiAllowanceDevUtility({ api, paths }) {
  const resourceRoot = path.join(paths.pluginRoot, AI_ALLOWANCE_RESOURCE_PATH);
  const settingsByContext = new Map();
  const bandIndexByContext = new Map();

  function currentSettings(message = {}) {
    const context = contextFrom(message);
    const incoming = settingsFrom(message);
    if (incoming && Object.keys(incoming).length > 0) {
      const settings = normalizeDevSettings(incoming);
      if (context) {
        settingsByContext.set(context, settings);
      }
      return settings;
    }

    return settingsByContext.get(context) || normalizeDevSettings({});
  }

  function renderBand(context, settings, band) {
    const now = new Date();
    const snapshot = createDevAllowanceSnapshot(band, settings, now);
    const title = titleForPreview(band, settings, snapshot);
    const svg = generateAllowanceIconSvg(snapshot, settings, now, { resourceRoot });

    if (typeof api.setBaseDataIcon === "function") {
      api.setBaseDataIcon(context, svgBase64(svg), title);
    } else {
      api.setStateIcon?.(context, 0, title);
    }

    api.sendToPropertyInspector?.({
      type: "aiAllowanceDevPreview",
      settings,
      preview: statusForPreview(band, settings, snapshot)
    }, context);

    return { settings, snapshot, band };
  }

  function renderCurrent(message = {}) {
    const context = contextFrom(message);
    if (!context) {
      return null;
    }

    const settings = currentSettings(message);
    const index = bandIndexByContext.get(context) || 0;
    return renderBand(context, settings, DEV_VISUAL_BANDS[index]);
  }

  function handleSettingsMessage(message = {}) {
    const context = contextFrom(message);
    if (!context) {
      return;
    }

    const settings = currentSettings(message);
    bandIndexByContext.set(context, 0);
    renderBand(context, settings, DEV_VISUAL_BANDS[0]);
  }

  async function handleCli(argv = process.argv) {
    const index = argv.indexOf("--ai-allowance-dev-preview");
    if (index === -1) {
      return false;
    }

    const provider = argv[index + 1] || "codex";
    const bandArgIndex = argv.indexOf("--band");
    const band = DEV_VISUAL_BANDS.includes(argv[bandArgIndex + 1])
      ? argv[bandArgIndex + 1]
      : "full";
    const windowArgIndex = argv.indexOf("--window");
    const sampleModeArgIndex = argv.indexOf("--sample-mode");
    const settings = normalizeDevSettings({
      provider,
      window: windowArgIndex === -1 ? "five_hour" : argv[windowArgIndex + 1],
      sampleMode: sampleModeArgIndex === -1 ? "boundary" : argv[sampleModeArgIndex + 1]
    });
    const snapshot = createDevAllowanceSnapshot(band, settings);

    console.log(JSON.stringify({
      settings,
      preview: statusForPreview(band, settings, snapshot),
      snapshot
    }, null, 2));
    return true;
  }

  return {
    actionUuid: AI_ALLOWANCE_DEV_ACTION_UUID,
    name: "AI Allowance Dev Cycle",
    handleCli,
    onAdd: handleSettingsMessage,
    onParamFromPlugin: handleSettingsMessage,
    onParamFromApp: handleSettingsMessage,
    onDidReceiveSettings: handleSettingsMessage,
    onSendToPlugin(message = {}) {
      const context = contextFrom(message);
      const payload = message?.payload || {};
      if (!context || payload.type !== "renderAiAllowanceDevPreview") {
        return;
      }

      if (payload.settings) {
        settingsByContext.set(context, normalizeDevSettings(payload.settings));
      }
      renderCurrent(message);
    },
    onRun(message = {}) {
      const context = contextFrom(message);
      if (!context) {
        return;
      }

      const settings = currentSettings(message);
      const currentIndex = bandIndexByContext.get(context) || 0;
      const nextIndex = (currentIndex + 1) % DEV_VISUAL_BANDS.length;
      bandIndexByContext.set(context, nextIndex);
      renderBand(context, settings, DEV_VISUAL_BANDS[nextIndex]);
    }
  };
}
