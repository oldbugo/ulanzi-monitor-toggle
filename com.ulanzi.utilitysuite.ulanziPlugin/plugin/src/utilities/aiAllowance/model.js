export const PROVIDERS = new Set(["codex", "claude"]);
export const WINDOWS = new Set(["five_hour", "weekly"]);
export const SOURCES = new Set(["auto_status", "manual"]);
export const ANIMATIONS = new Set(["transition", "off"]);

export const PROVIDER_LABELS = {
  codex: "Codex",
  claude: "Claude"
};

export const WINDOW_LABELS = {
  five_hour: "5h",
  weekly: "Week"
};

const WINDOW_DURATIONS_MS = {
  five_hour: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

const LEGACY_DEFAULT_VISUAL_THRESHOLDS = {
  visualFullPercent: 76,
  visualHealthyPercent: 51,
  visualCautionPercent: 26,
  visualWarningPercent: 11,
  visualCriticalPercent: 10
};

const DEFAULT_SETTINGS = {
  provider: "codex",
  window: "five_hour",
  source: "auto_status",
  label: "",
  warningPercent: 25,
  criticalPercent: 10,
  visualFullPercent: 80,
  visualHealthyPercent: 65,
  visualCautionPercent: 40,
  visualWarningPercent: 20,
  visualCriticalPercent: 19,
  animation: "transition",
  remainingPercent: "",
  resetAt: "",
  notes: ""
};

function clampPercent(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeText(value, maxLength = 80) {
  return String(value || "").trim().slice(0, maxLength);
}

function hasLegacyDefaultVisualThresholds(raw = {}) {
  return Object.entries(LEGACY_DEFAULT_VISUAL_THRESHOLDS).every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(raw, key) &&
      clampPercent(raw[key], null) === value
  );
}

export function normalizeResetAt(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function normalizeAiAllowanceSettings(raw = {}) {
  const provider = PROVIDERS.has(raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider;
  const window = WINDOWS.has(raw.window) ? raw.window : DEFAULT_SETTINGS.window;
  const source = SOURCES.has(raw.source) ? raw.source : DEFAULT_SETTINGS.source;
  const animation = ANIMATIONS.has(raw.animation) ? raw.animation : DEFAULT_SETTINGS.animation;
  const criticalPercent = clampPercent(raw.criticalPercent, DEFAULT_SETTINGS.criticalPercent);
  const warningPercent = Math.max(
    criticalPercent,
    clampPercent(raw.warningPercent, DEFAULT_SETTINGS.warningPercent)
  );
  const visualSource = hasLegacyDefaultVisualThresholds(raw) ? {} : raw;
  const visualWarningPercent = clampPercent(visualSource.visualWarningPercent, DEFAULT_SETTINGS.visualWarningPercent);
  const visualCriticalPercent = Math.min(
    clampPercent(visualSource.visualCriticalPercent, DEFAULT_SETTINGS.visualCriticalPercent),
    Math.max(0, visualWarningPercent - 1)
  );
  const visualCautionPercent = Math.max(
    visualWarningPercent,
    clampPercent(visualSource.visualCautionPercent, DEFAULT_SETTINGS.visualCautionPercent)
  );
  const visualHealthyPercent = Math.max(
    visualCautionPercent,
    clampPercent(visualSource.visualHealthyPercent, DEFAULT_SETTINGS.visualHealthyPercent)
  );
  const visualFullPercent = Math.max(
    visualHealthyPercent,
    clampPercent(visualSource.visualFullPercent, DEFAULT_SETTINGS.visualFullPercent)
  );
  const remainingPercent = raw.remainingPercent === "" || raw.remainingPercent === undefined || raw.remainingPercent === null
    ? null
    : clampPercent(raw.remainingPercent, null);

  return {
    provider,
    window,
    source,
    label: normalizeText(raw.label),
    warningPercent,
    criticalPercent,
    visualFullPercent,
    visualHealthyPercent,
    visualCautionPercent,
    visualWarningPercent,
    visualCriticalPercent,
    animation,
    remainingPercent,
    resetAt: normalizeResetAt(raw.resetAt),
    notes: normalizeText(raw.notes, 160)
  };
}

export function hasAiAllowanceSettingsPayload(settings = {}) {
  return Boolean(
    settings &&
      typeof settings === "object" &&
      (
        Object.prototype.hasOwnProperty.call(settings, "provider") ||
        Object.prototype.hasOwnProperty.call(settings, "window") ||
        Object.prototype.hasOwnProperty.call(settings, "source") ||
        Object.prototype.hasOwnProperty.call(settings, "animation") ||
        Object.prototype.hasOwnProperty.call(settings, "warningPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "criticalPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "visualFullPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "visualHealthyPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "visualCautionPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "visualWarningPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "visualCriticalPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "remainingPercent") ||
        Object.prototype.hasOwnProperty.call(settings, "resetAt")
      )
  );
}

export function rollResetAt(resetAt, window, now = new Date()) {
  const duration = WINDOW_DURATIONS_MS[window] || WINDOW_DURATIONS_MS.five_hour;
  const initial = normalizeResetAt(resetAt);
  if (!initial) {
    return "";
  }

  let timestamp = new Date(initial).getTime();
  const nowTime = now.getTime();
  while (timestamp <= nowTime) {
    timestamp += duration;
  }

  return new Date(timestamp).toISOString();
}

export function snapshotLevel(snapshot, settings) {
  if (snapshot.remainingPercent === null || snapshot.remainingPercent === undefined) {
    return "unknown";
  }

  if (snapshot.remainingPercent <= settings.criticalPercent) {
    return "critical";
  }

  if (snapshot.remainingPercent <= settings.warningPercent) {
    return "warning";
  }

  return "ok";
}

export function manualSnapshotFromSettings(settings, now = new Date()) {
  const resetAt = settings.resetAt ? rollResetAt(settings.resetAt, settings.window, now) : "";
  const resetPassed = Boolean(settings.resetAt && resetAt !== settings.resetAt);
  const remainingPercent = resetPassed
    ? 100
    : settings.remainingPercent;
  const hasRemaining = remainingPercent !== null && remainingPercent !== undefined;
  const hasReset = Boolean(resetAt);
  const message = hasRemaining
    ? "Manual allowance value."
    : "Set manual remaining percent to track this allowance.";

  const snapshot = {
    provider: settings.provider,
    window: settings.window,
    source: "manual",
    status: hasRemaining || hasReset ? "manual" : "unknown",
    remainingPercent: hasRemaining ? remainingPercent : null,
    resetAt: resetAt || null,
    fetchedAt: now.toISOString(),
    message,
    cliVersion: null
  };

  return {
    ...snapshot,
    level: snapshotLevel(snapshot, settings)
  };
}

export function unknownSnapshot(settings, message, now = new Date()) {
  return {
    provider: settings.provider,
    window: settings.window,
    source: settings.source,
    status: "unknown",
    level: "unknown",
    remainingPercent: null,
    resetAt: null,
    fetchedAt: now.toISOString(),
    cliVersion: null,
    message
  };
}

export function staleSnapshotFromCache(record, settings, now = new Date()) {
  const cached = record?.snapshot || record;
  if (!cached || typeof cached !== "object") {
    return null;
  }

  const fetchedAt = normalizeResetAt(cached.fetchedAt);
  if (!fetchedAt) {
    return null;
  }

  const remainingPercent = cached.remainingPercent === null || cached.remainingPercent === undefined
    ? null
    : clampPercent(cached.remainingPercent, null);
  const resetAt = normalizeResetAt(cached.resetAt);
  const snapshot = {
    provider: settings.provider,
    window: settings.window,
    source: cached.source || settings.source,
    status: "stale",
    remainingPercent,
    resetAt: resetAt || null,
    fetchedAt,
    staleAt: now.toISOString(),
    cliVersion: cached.cliVersion || null,
    message: `Using cached allowance state from ${fetchedAt}. Refresh to verify.`
  };

  return {
    ...snapshot,
    level: snapshotLevel(snapshot, settings)
  };
}
