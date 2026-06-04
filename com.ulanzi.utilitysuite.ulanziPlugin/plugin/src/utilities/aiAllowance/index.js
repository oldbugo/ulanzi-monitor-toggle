import fs from "node:fs";
import path from "node:path";

import { contextFrom, settingsFrom } from "../../runtime/messages.js";
import { AI_ALLOWANCE_ACTION_UUID } from "../../suite/identifiers.js";
import {
  ANIMATIONS,
  PROVIDER_LABELS,
  PROVIDERS,
  SOURCES,
  WINDOW_LABELS,
  WINDOWS,
  hasAiAllowanceSettingsPayload,
  manualSnapshotFromSettings,
  normalizeAiAllowanceSettings,
  normalizeResetAt,
  rollResetAt,
  snapshotLevel,
  staleSnapshotFromCache,
  unknownSnapshot
} from "./model.js";
import {
  PROVIDER_ADAPTERS,
  mergeClaudeOauthRefreshCredentials,
  normalizeClaudeOauthUsageSnapshot,
  normalizeCodexUsageSnapshot,
  resolveAutoStatusSnapshot,
  runCommand
} from "./providers.js";

const SCHEDULED_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TRANSITION_ICON_SETTLE_MS = 1800;
const AI_ALLOWANCE_RESOURCE_PATH = "resources/actions/ai-allowance";
const VISUAL_BANDS = ["full", "healthy", "caution", "warning", "critical", "unknown"];

export {
  PROVIDER_ADAPTERS,
  ANIMATIONS,
  PROVIDER_LABELS,
  PROVIDERS,
  SOURCES,
  WINDOW_LABELS,
  WINDOWS,
  VISUAL_BANDS,
  hasAiAllowanceSettingsPayload,
  manualSnapshotFromSettings,
  mergeClaudeOauthRefreshCredentials,
  normalizeClaudeOauthUsageSnapshot,
  normalizeCodexUsageSnapshot,
  normalizeAiAllowanceSettings,
  normalizeResetAt,
  rollResetAt,
  runCommand,
  snapshotLevel,
  staleSnapshotFromCache,
  unknownSnapshot
};

export async function resolveAllowanceSnapshot(settings, now = new Date()) {
  if (settings.source === "manual") {
    return manualSnapshotFromSettings(settings, now);
  }

  return resolveAutoStatusSnapshot(settings, now);
}

function stableContextName(context) {
  return String(context || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function relativeTimeUntil(isoValue, now = new Date()) {
  if (!isoValue) {
    return "";
  }

  const deltaMs = new Date(isoValue).getTime() - now.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return "now";
  }

  const totalMinutes = Math.ceil(deltaMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `${days}d${restHours ? ` ${restHours}h` : ""}`;
  }

  if (hours > 0) {
    return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
  }

  return `${minutes}m`;
}

function snapshotTitle(snapshot, settings) {
  const label = settings.label || PROVIDER_LABELS[settings.provider];
  if (snapshot.remainingPercent !== null && snapshot.remainingPercent !== undefined) {
    return `${label} ${snapshot.remainingPercent}%`;
  }

  if (snapshot.status === "stale") {
    return `${label} Stale`;
  }

  if (snapshot.status === "manual") {
    return `${label} Manual`;
  }

  return `${label} Unknown`;
}

function snapshotSubtitle(snapshot, settings, now = new Date()) {
  const reset = relativeTimeUntil(snapshot.resetAt, now);
  if (reset) {
    return `${WINDOW_LABELS[settings.window]} resets ${reset}`;
  }

  return `${WINDOW_LABELS[settings.window]} ${snapshot.status}`;
}

function svgBase64(svg) {
  return Buffer.from(svg, "utf8").toString("base64");
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function visualBandFromSnapshot(snapshot) {
  if (snapshot?.remainingPercent === null || snapshot?.remainingPercent === undefined) {
    return "unknown";
  }

  const remaining = Number(snapshot?.remainingPercent);
  if (!Number.isFinite(remaining)) {
    return "unknown";
  }

  if (remaining >= 76) {
    return "full";
  }

  if (remaining >= 51) {
    return "healthy";
  }

  if (remaining >= 26) {
    return "caution";
  }

  if (remaining >= 11) {
    return "warning";
  }

  return "critical";
}

function visualBandColors(band, source, status) {
  if (band === "unknown" && status === "stale") {
    return { background: "#475569", foreground: "#f8fafc", accent: "#cbd5e1" };
  }

  switch (band) {
    case "full":
      return { background: "#0f766e", foreground: "#ecfeff", accent: "#99f6e4" };
    case "healthy":
      return { background: "#166534", foreground: "#f0fdf4", accent: "#bbf7d0" };
    case "caution":
      return { background: "#854d0e", foreground: "#fffbeb", accent: "#fde68a" };
    case "warning":
      return { background: "#b45309", foreground: "#fff7ed", accent: "#fed7aa" };
    case "critical":
      return { background: "#991b1b", foreground: "#fee2e2", accent: "#fca5a5" };
    case "unknown":
    default:
      if (source === "manual") {
        return { background: "#1d4ed8", foreground: "#eff6ff", accent: "#93c5fd" };
      }
      return { background: "#334155", foreground: "#e2e8f0", accent: "#94a3b8" };
  }
}

function relativeAssetPath(...parts) {
  return path.posix.join(AI_ALLOWANCE_RESOURCE_PATH, ...parts);
}

function absoluteAssetPath(resourceRoot, ...parts) {
  return path.join(resourceRoot, ...parts);
}

export function allowanceBackgroundAssetPath(provider, band) {
  return relativeAssetPath("backgrounds", provider, `${band}.svg`);
}

export function allowanceTransitionAssetPath(provider, band) {
  return relativeAssetPath("transitions", provider, `${band}.gif`);
}

function extractSvgInner(svg) {
  const match = String(svg || "")
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  return match?.[1]?.trim() || "";
}

function backgroundLayerSvg(snapshot, settings, band, colors, options = {}) {
  const resourceRoot = options.resourceRoot;
  if (resourceRoot && band !== "unknown") {
    const file = absoluteAssetPath(resourceRoot, "backgrounds", settings.provider, `${band}.svg`);
    if (fs.existsSync(file)) {
      const inner = extractSvgInner(fs.readFileSync(file, "utf8"));
      if (inner) {
        return `<g data-background-provider="${escapeSvgText(settings.provider)}" data-background-band="${escapeSvgText(band)}">${inner}</g>`;
      }
    }
  }

  return `<rect width="144" height="144" rx="18" fill="${colors.background}"/>`;
}

export function generateAllowanceIconSvg(snapshot, settings, now = new Date(), options = {}) {
  const band = visualBandFromSnapshot(snapshot);
  const colors = visualBandColors(band, snapshot.source, snapshot.status);
  const provider = settings.provider === "claude" ? "CLAUDE" : "CODEX";
  const percent = snapshot.remainingPercent === null || snapshot.remainingPercent === undefined
    ? "?"
    : `${snapshot.remainingPercent}%`;
  const reset = relativeTimeUntil(snapshot.resetAt, now) || WINDOW_LABELS[settings.window];
  const mode = snapshot.status === "stale"
    ? "STALE"
    : snapshot.source === "manual"
      ? "MANUAL"
      : snapshot.status.toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${backgroundLayerSvg(snapshot, settings, band, colors, options)}
  <text x="72" y="30" text-anchor="middle" fill="${colors.accent}" stroke="#000000" stroke-opacity="0.18" stroke-width="3" paint-order="stroke" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeSvgText(provider)}</text>
  <text x="72" y="78" text-anchor="middle" fill="${colors.foreground}" stroke="#000000" stroke-opacity="0.22" stroke-width="4" paint-order="stroke" font-family="Arial, sans-serif" font-size="38" font-weight="800">${escapeSvgText(percent)}</text>
  <text x="72" y="105" text-anchor="middle" fill="${colors.foreground}" stroke="#000000" stroke-opacity="0.20" stroke-width="3" paint-order="stroke" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeSvgText(reset)}</text>
  <text x="72" y="126" text-anchor="middle" fill="${colors.accent}" stroke="#000000" stroke-opacity="0.18" stroke-width="2" paint-order="stroke" font-family="Arial, sans-serif" font-size="12" font-weight="700">${escapeSvgText(mode)}</text>
</svg>`;
}

export function shouldUseTransitionAnimation(previousBand, currentBand, snapshot, settings, transitionExists, api) {
  const remaining = snapshot?.remainingPercent;
  const hasKnownRemaining =
    remaining !== null &&
    remaining !== undefined &&
    Number.isFinite(Number(remaining));
  return Boolean(
    settings.animation === "transition" &&
      hasKnownRemaining &&
      currentBand !== "unknown" &&
      previousBand &&
      previousBand !== currentBand &&
      transitionExists &&
      (
        typeof api?.setGifPathIcon === "function" ||
        typeof api?.setGifDataIcon === "function"
      )
  );
}

export function createAiAllowanceUtility({ api, paths }) {
  const stateRoot = path.join(paths.stateRoot, "ai-allowance");
  const resourceRoot = path.join(paths.pluginRoot, AI_ALLOWANCE_RESOURCE_PATH);
  const settingsByContext = new Map();
  const snapshotsByContext = new Map();
  const visualBandsByContext = new Map();
  const transitionTimersByContext = new Map();
  let refreshTimer = null;

  function statePathFor(context) {
    return path.join(stateRoot, `${stableContextName(context)}.json`);
  }

  function readCachedRecord(context) {
    const file = statePathFor(context);
    if (!fs.existsSync(file)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      api.logMessage?.(`AI Allowance Monitor cache read failed: ${error.message}`);
      return null;
    }
  }

  function cacheSettings(message = {}) {
    const context = contextFrom(message);
    const rawSettings = settingsFrom(message);
    const settings = normalizeAiAllowanceSettings(rawSettings);
    if (!context) {
      return settings;
    }

    if (hasAiAllowanceSettingsPayload(rawSettings)) {
      settingsByContext.set(context, settings);
      return settings;
    }

    return settingsByContext.get(context) || settings;
  }

  function currentSettings(message = {}) {
    const context = contextFrom(message);
    const incoming = settingsFrom(message);
    if (hasAiAllowanceSettingsPayload(incoming)) {
      return cacheSettings(message);
    }

    return settingsByContext.get(context) || normalizeAiAllowanceSettings({});
  }

  function writeSnapshot(context, settings, snapshot) {
    fs.mkdirSync(stateRoot, { recursive: true });
    const record = { settings, snapshot };
    fs.writeFileSync(statePathFor(context), JSON.stringify(record, null, 2));
    snapshotsByContext.set(context, snapshot);
  }

  function clearTransitionTimer(context) {
    const timer = transitionTimersByContext.get(context);
    if (timer) {
      clearTimeout(timer);
      transitionTimersByContext.delete(context);
    }
  }

  function setStaticButtonIcon(context, settings, snapshot, title, subtitle, now) {
    if (typeof api.setBaseDataIcon === "function") {
      api.setBaseDataIcon(
        context,
        svgBase64(generateAllowanceIconSvg(snapshot, settings, now, { resourceRoot })),
        title
      );
      return;
    }

    const state = snapshot.level === "critical"
      ? 2
      : snapshot.level === "warning"
        ? 1
        : snapshot.level === "ok"
          ? 0
          : 3;
    api.setStateIcon?.(context, state, title || subtitle);
  }

  function setTransitionIcon(context, settings, band, title) {
    const relativeGifPath = allowanceTransitionAssetPath(settings.provider, band);
    const absoluteGifPath = path.join(paths.pluginRoot, relativeGifPath);
    if (!fs.existsSync(absoluteGifPath)) {
      return false;
    }

    if (typeof api.setGifPathIcon === "function") {
      api.setGifPathIcon(context, relativeGifPath, title);
      return true;
    }

    if (typeof api.setGifDataIcon === "function") {
      api.setGifDataIcon(context, fs.readFileSync(absoluteGifPath).toString("base64"), title);
      return true;
    }

    return false;
  }

  function setButtonIcon(context, settings, snapshot) {
    const now = new Date();
    const title = snapshotTitle(snapshot, settings);
    const subtitle = snapshotSubtitle(snapshot, settings, now);
    const previousBand = visualBandsByContext.get(context);
    const currentBand = visualBandFromSnapshot(snapshot);
    const transitionPath = path.join(resourceRoot, "transitions", settings.provider, `${currentBand}.gif`);
    const transitionExists = fs.existsSync(transitionPath);
    const shouldAnimate = shouldUseTransitionAnimation(
      previousBand,
      currentBand,
      snapshot,
      settings,
      transitionExists,
      api
    );

    visualBandsByContext.set(context, currentBand);
    clearTransitionTimer(context);

    let didStartTransition = false;
    if (shouldAnimate) {
      try {
        didStartTransition = setTransitionIcon(context, settings, currentBand, title);
      } catch (error) {
        api.logMessage?.(`AI Allowance Monitor transition icon failed: ${error.message}`);
      }
    }

    if (didStartTransition) {
      const timer = setTimeout(() => {
        transitionTimersByContext.delete(context);
        setStaticButtonIcon(context, settings, snapshot, title, subtitle, new Date());
      }, TRANSITION_ICON_SETTLE_MS);
      transitionTimersByContext.set(context, timer);
      return;
    }

    setStaticButtonIcon(context, settings, snapshot, title, subtitle, now);
  }

  function showCachedSnapshot(context, settings, options = {}) {
    const snapshot = staleSnapshotFromCache(readCachedRecord(context), settings);
    if (!snapshot) {
      return null;
    }

    snapshotsByContext.set(context, snapshot);
    setButtonIcon(context, settings, snapshot);

    if (options.sendToInspector) {
      api.sendToPropertyInspector?.({ type: "allowanceStatus", settings, snapshot }, context);
    }

    return snapshot;
  }

  async function refreshContext(context, settings, options = {}) {
    let snapshot;
    try {
      snapshot = await resolveAllowanceSnapshot(settings);
    } catch (error) {
      snapshot = showCachedSnapshot(context, settings) || unknownSnapshot(settings, error.message);
    }

    writeSnapshot(context, settings, snapshot);
    setButtonIcon(context, settings, snapshot);

    if (options.sendToInspector) {
      api.sendToPropertyInspector?.({ type: "allowanceStatus", settings, snapshot }, context);
    }

    return snapshot;
  }

  function handleSettingsMessage(message = {}) {
    const context = contextFrom(message);
    const settings = cacheSettings(message);
    if (!context) {
      return;
    }

    showCachedSnapshot(context, settings);
    refreshContext(context, settings).catch((error) => {
      api.logMessage?.(`AI Allowance Monitor refresh failed: ${error.message}`);
      api.showAlert?.(context);
    });
  }

  function ensureRefreshTimer() {
    if (refreshTimer) {
      return;
    }

    refreshTimer = setInterval(() => {
      for (const [context, settings] of settingsByContext) {
        refreshContext(context, settings).catch((error) => {
          api.logMessage?.(`AI Allowance Monitor scheduled refresh failed: ${error.message}`);
        });
      }
    }, SCHEDULED_REFRESH_INTERVAL_MS);
  }

  async function handleCli(argv = process.argv) {
    const index = argv.indexOf("--ai-allowance-status");
    if (index === -1) {
      return false;
    }

    const provider = argv[index + 1] || "codex";
    const windowArgIndex = argv.indexOf("--window");
    const window = windowArgIndex === -1 ? "five_hour" : argv[windowArgIndex + 1];
    const sourceArgIndex = argv.indexOf("--source");
    const source = sourceArgIndex === -1 ? "auto_status" : argv[sourceArgIndex + 1];
    const settings = normalizeAiAllowanceSettings({ provider, window, source });
    let snapshot;
    try {
      snapshot = await resolveAllowanceSnapshot(settings);
    } catch (error) {
      snapshot = unknownSnapshot(settings, error.message);
    }

    console.log(JSON.stringify({ settings, snapshot }, null, 2));
    return true;
  }

  return {
    actionUuid: AI_ALLOWANCE_ACTION_UUID,
    name: "AI Allowance Monitor",
    handleCli,
    start: ensureRefreshTimer,
    stop() {
      clearInterval(refreshTimer);
      refreshTimer = null;
      for (const context of transitionTimersByContext.keys()) {
        clearTransitionTimer(context);
      }
    },
    onConnected: ensureRefreshTimer,
    onAdd: handleSettingsMessage,
    onParamFromPlugin: handleSettingsMessage,
    onParamFromApp: handleSettingsMessage,
    onDidReceiveSettings: handleSettingsMessage,
    onSendToPlugin(message = {}) {
      const context = contextFrom(message);
      const payload = message?.payload || {};
      if (!context || payload.type !== "refreshAllowance") {
        return;
      }

      const settings = payload.settings
        ? normalizeAiAllowanceSettings(payload.settings)
        : currentSettings(message);
      if (payload.settings) {
        settingsByContext.set(context, settings);
      }
      refreshContext(context, settings, { sendToInspector: true }).catch((error) => {
        api.logMessage?.(`AI Allowance Monitor inspector refresh failed: ${error.message}`);
        api.sendToPropertyInspector?.({
          type: "allowanceStatus",
          settings,
          snapshot: snapshotsByContext.get(context) || null,
          error: error.message
        }, context);
      });
    },
    onRun(message = {}) {
      const context = contextFrom(message);
      const settings = currentSettings(message);
      if (!context) {
        return;
      }

      refreshContext(context, settings).catch((error) => {
        api.logMessage?.(`AI Allowance Monitor refresh failed: ${error.message}`);
        api.showAlert?.(context);
      });
    }
  };
}
