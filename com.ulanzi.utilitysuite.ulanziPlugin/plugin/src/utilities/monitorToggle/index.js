import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { contextFrom, settingsFrom } from "../../runtime/messages.js";
import { powershellFileArgs, runJsonPowerShell } from "../../runtime/powershell.js";
import {
  LEGACY_MONITOR_TOGGLE_ACTION_UUID,
  MONITOR_TOGGLE_ACTION_UUID
} from "../../suite/identifiers.js";

const DEFAULT_COLORS = {
  active: "#0f766e",
  inactive: "#334155",
  foreground: "#ecfeff"
};
const ICON_PRESETS = new Set(["auto", "monitor", "group"]);

function normalizeColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function normalizeSettings(raw = {}) {
  const targetKeys = String(raw.targetKeys || "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    mode: raw.mode === "group" ? "group" : "single",
    targetKeys,
    iconPreset: ICON_PRESETS.has(raw.iconPreset) ? raw.iconPreset : "auto",
    activeColor: normalizeColor(raw.activeColor, DEFAULT_COLORS.active),
    inactiveColor: normalizeColor(raw.inactiveColor, DEFAULT_COLORS.inactive),
    foregroundColor: normalizeColor(raw.foregroundColor, DEFAULT_COLORS.foreground)
  };
}

function hasSettingsPayload(settings = {}) {
  return Boolean(
    settings &&
      typeof settings === "object" &&
      (
        Object.prototype.hasOwnProperty.call(settings, "mode") ||
        Object.prototype.hasOwnProperty.call(settings, "targetKeys") ||
        Object.prototype.hasOwnProperty.call(settings, "iconPreset") ||
        Object.prototype.hasOwnProperty.call(settings, "activeColor") ||
        Object.prototype.hasOwnProperty.call(settings, "inactiveColor") ||
        Object.prototype.hasOwnProperty.call(settings, "foregroundColor")
      )
  );
}

function targetIdAlias(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (text.toLowerCase().startsWith("target-id:")) {
    return text.toLowerCase();
  }

  const parts = text.split(":");
  if (parts.length === 3 && /^\d+$/.test(parts[2])) {
    return `target-id:${parts[2]}`;
  }

  const uid = text.match(/uid(\d+)/i);
  if (uid) {
    return `target-id:${uid[1]}`;
  }

  return "";
}

function activeKeySet(displays = []) {
  const keys = new Set();

  for (const display of displays) {
    for (const key of [display.key, display.legacyKey, ...(display.aliases || [])]) {
      const normalized = String(key || "").toLowerCase();
      if (normalized) {
        keys.add(normalized);
      }
    }

    if (display.targetId !== undefined && display.targetId !== null) {
      keys.add(`target-id:${display.targetId}`);
    }
  }

  return keys;
}

function isSettingsActive(settings, activeKeys) {
  if (!settings.targetKeys.length) {
    return false;
  }

  return settings.targetKeys.every((key) => {
    const normalized = String(key).toLowerCase();
    const alias = targetIdAlias(key);
    return activeKeys.has(normalized) || Boolean(alias && activeKeys.has(alias));
  });
}

function resolvedPreset(settings) {
  if (settings.iconPreset && settings.iconPreset !== "auto") {
    return settings.iconPreset;
  }

  return settings.mode === "group" ? "group" : "monitor";
}

function svgBase64(svg) {
  return Buffer.from(svg, "utf8").toString("base64");
}

function generateIconSvg(settings, active) {
  const background = active ? settings.activeColor : settings.inactiveColor;
  const foreground = settings.foregroundColor;
  const accent = active ? "#22c55e" : "#ef4444";
  const preset = resolvedPreset(settings);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="${background}"/>
  ${iconGlyph(preset, foreground, background)}
  <circle cx="106" cy="36" r="13" fill="${accent}"/>
  ${active
    ? `<path d="M100 36l4 4 8-9" fill="none" stroke="${foreground}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M101 31l11 11M112 31l-11 11" fill="none" stroke="${foreground}" stroke-width="4" stroke-linecap="round"/>`}
</svg>`;
}

function iconGlyph(preset, foreground, background) {
  switch (preset) {
    case "group":
      return `
  <rect x="22" y="38" width="60" height="44" rx="7" fill="${foreground}" opacity="0.72"/>
  <rect x="34" y="50" width="68" height="48" rx="8" fill="${foreground}"/>
  <rect x="44" y="60" width="48" height="28" rx="3" fill="${background}" opacity="0.82"/>
  <rect x="62" y="102" width="14" height="10" fill="${foreground}"/>
  <rect x="48" y="114" width="42" height="8" rx="4" fill="${foreground}"/>`;
    case "monitor":
    default:
      return `
  <rect x="28" y="34" width="88" height="58" rx="8" fill="${foreground}"/>
  <rect x="38" y="44" width="68" height="38" rx="3" fill="${background}" opacity="0.78"/>
  <rect x="64" y="96" width="16" height="12" fill="${foreground}"/>
  <rect x="50" y="110" width="44" height="8" rx="4" fill="${foreground}"/>`;
  }
}

export function createMonitorToggleUtility({ api, paths }) {
  const windowsDisplayControlPath = path.join(paths.scriptsDir, "WindowsDisplayControl.ps1");
  const windowsDisplayWatcherPath = path.join(paths.scriptsDir, "WindowsDisplayWatcher.ps1");
  const stateRoot = path.join(paths.stateRoot, "monitor-toggle");

  const settingsByContext = new Map();
  const pendingRunsByContext = new Map();
  const settingsRequestsByContext = new Set();
  let displayWatcher = null;
  let displayWatcherRestartTimer = null;
  let displayRefreshTimer = null;
  let shuttingDown = false;

  function snapshotPathFor(context) {
    const stableName = String(context || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
    return path.join(stateRoot, `${MONITOR_TOGGLE_ACTION_UUID}.${stableName}.full-layout.bin`);
  }

  function snapshotCandidatesIn(directory, prefixes, primary) {
    if (!fs.existsSync(directory)) {
      return [];
    }

    const suffix = ".full-layout.bin";
    return fs.readdirSync(directory)
      .filter((file) => prefixes.some((prefix) => file.startsWith(`${prefix}.`)) && file.endsWith(suffix))
      .map((file) => path.join(directory, file))
      .filter((file) => file !== primary)
      .map((file) => ({
        file,
        modified: fs.statSync(file).mtimeMs
      }))
      .sort((left, right) => right.modified - left.modified)
      .map((entry) => entry.file);
  }

  function snapshotCandidatesFor(context) {
    const primary = snapshotPathFor(context);
    const candidates = [];

    if (fs.existsSync(primary)) {
      candidates.push(primary);
    }

    candidates.push(
      ...snapshotCandidatesIn(stateRoot, [MONITOR_TOGGLE_ACTION_UUID], primary),
      ...snapshotCandidatesIn(paths.legacyMonitorStateRoot, [LEGACY_MONITOR_TOGGLE_ACTION_UUID], primary)
    );

    return candidates;
  }

  function cacheSettings(message = {}) {
    const context = contextFrom(message);
    const rawSettings = settingsFrom(message);
    const settings = normalizeSettings(rawSettings);
    if (!context) {
      return settings;
    }

    if (hasSettingsPayload(rawSettings)) {
      settingsByContext.set(context, settings);
      return settings;
    }

    return settingsByContext.get(context) || settings;
  }

  function currentSettings(message = {}) {
    const context = contextFrom(message);
    const incoming = settingsFrom(message);

    if (hasSettingsPayload(incoming)) {
      return cacheSettings(message);
    }

    return settingsByContext.get(context) || normalizeSettings({});
  }

  function requestSavedSettings(context) {
    if (!context || settingsRequestsByContext.has(context)) {
      return;
    }

    settingsRequestsByContext.add(context);
    api.getSettings?.(context);

    setTimeout(() => {
      if (!settingsRequestsByContext.has(context)) {
        return;
      }

      settingsRequestsByContext.delete(context);
      if (pendingRunsByContext.has(context)) {
        pendingRunsByContext.delete(context);
        api.logMessage?.("Monitor Toggle: saved settings were not received before timeout.");
        api.showAlert?.(context);
      }
    }, 2500);
  }

  function handleSettingsMessage(message = {}) {
    const context = contextFrom(message);
    const rawSettings = settingsFrom(message);
    if (!context || !hasSettingsPayload(rawSettings)) {
      requestSavedSettings(context);
      return null;
    }

    settingsRequestsByContext.delete(context);
    const settings = cacheSettings(message);

    if (pendingRunsByContext.has(context)) {
      pendingRunsByContext.delete(context);
      toggle(context, settings).catch((error) => {
        api.logMessage?.(`Monitor Toggle failed: ${error.message}`);
        api.showAlert?.(context);
      });
    }

    return settings;
  }

  function runWindowsDisplayControl(action, options = {}) {
    fs.mkdirSync(stateRoot, { recursive: true });

    const args = ["-Action", action];

    if (options.targetKeys?.length) {
      args.push("-TargetKeys", options.targetKeys.join(","));
    }

    if (options.snapshotPath) {
      args.push("-SnapshotPath", options.snapshotPath);
    }

    return runJsonPowerShell(windowsDisplayControlPath, args);
  }

  function scheduleDisplayRefresh(reason = "display-change") {
    clearTimeout(displayRefreshTimer);
    displayRefreshTimer = setTimeout(() => {
      refreshAllButtonStates(reason).catch((error) => {
        api.logMessage?.(`Monitor Toggle display refresh failed: ${error.message}`);
      });
    }, 1200);
  }

  async function refreshAllButtonStates(reason = "display-change") {
    if (!settingsByContext.size) {
      return;
    }

    const result = await runWindowsDisplayControl("list");
    syncButtonStatesFromDisplays(result.displays || []);
    api.logMessage?.(`Monitor Toggle refreshed states after ${reason}.`);
  }

  function handleDisplayWatcherLine(line) {
    const text = String(line || "").trim();
    if (!text) {
      return;
    }

    let event;
    try {
      event = JSON.parse(text);
    } catch {
      api.logMessage?.(`Monitor Toggle display watcher output: ${text}`);
      return;
    }

    if (event.type === "watcher-started") {
      api.logMessage?.("Monitor Toggle display watcher started.");
      return;
    }

    if (event.type === "watcher-registration-failed") {
      const source = event.source ? ` (${event.source})` : "";
      const detail = event.detail ? `: ${event.detail}` : "";
      api.logMessage?.(`Monitor Toggle display watcher registration failed${source}${detail}`);
      return;
    }

    if (event.type === "display-settings-changed" || event.type === "display-device-changed") {
      const source = event.source ? ` via ${event.source}` : "";
      scheduleDisplayRefresh(`windows display change${source}`);
    }
  }

  function startDisplayWatcher() {
    if (process.argv.includes("--list-displays") || displayWatcher) {
      return;
    }

    shuttingDown = false;
    clearTimeout(displayWatcherRestartTimer);

    displayWatcher = spawn("powershell.exe", powershellFileArgs(windowsDisplayWatcherPath, [], { sta: true }), {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    displayWatcher.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        handleDisplayWatcherLine(line);
      }
    });

    displayWatcher.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    displayWatcher.on("error", (error) => {
      api.logMessage?.(`Monitor Toggle display watcher failed: ${error.message}`);
    });

    displayWatcher.on("close", (code) => {
      displayWatcher = null;
      const message = stderr.trim();
      if (message) {
        api.logMessage?.(`Monitor Toggle display watcher stderr: ${message}`);
      }

      if (!shuttingDown) {
        api.logMessage?.(`Monitor Toggle display watcher exited with code ${code}; restarting.`);
        displayWatcherRestartTimer = setTimeout(startDisplayWatcher, 10000);
      }
    });
  }

  function stopDisplayWatcher() {
    shuttingDown = true;
    clearTimeout(displayWatcherRestartTimer);
    clearTimeout(displayRefreshTimer);

    if (displayWatcher) {
      displayWatcher.kill();
      displayWatcher = null;
    }
  }

  function syncButtonStatesFromDisplays(displays = []) {
    const activeKeys = activeKeySet(displays);

    for (const [context, settings] of settingsByContext) {
      if (!settings.targetKeys.length) {
        continue;
      }

      setButtonIcon(context, settings, isSettingsActive(settings, activeKeys));
    }
  }

  async function syncButtonState(context, settings) {
    if (!settings.targetKeys.length) {
      return;
    }

    const result = await runWindowsDisplayControl("list");
    const displays = result.displays || [];
    setButtonIcon(context, settings, isSettingsActive(settings, activeKeySet(displays)));
  }

  async function enableFromSnapshots(context, settings) {
    let lastError;

    for (const snapshotPath of snapshotCandidatesFor(context)) {
      try {
        const result = await runWindowsDisplayControl("enable", {
          targetKeys: settings.targetKeys,
          snapshotPath
        });

        if (result.matchedTargetCount > 0) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("No saved display snapshot contains the selected monitor.");
  }

  async function toggle(context, rawSettings) {
    const settings = normalizeSettings(rawSettings);

    if (!settings.targetKeys.length) {
      api.showAlert?.(context);
      api.logMessage?.("Monitor Toggle: no target keys configured.");
      return;
    }

    const current = await runWindowsDisplayControl("list");
    const currentlyActive = isSettingsActive(settings, activeKeySet(current.displays || []));
    const result = currentlyActive
      ? await runWindowsDisplayControl("disable", {
          targetKeys: settings.targetKeys,
          snapshotPath: snapshotPathFor(context)
        })
      : await enableFromSnapshots(context, settings);

    syncButtonStatesFromDisplays(result.displays || []);
    scheduleDisplayRefresh("monitor toggle");
  }

  function setButtonIcon(context, settings, active) {
    if (typeof api.setBaseDataIcon !== "function") {
      api.setStateIcon(context, active ? 0 : 1, active ? "On" : "Off");
      return;
    }

    const data = svgBase64(generateIconSvg(settings, active));
    api.setBaseDataIcon(context, data, active ? "On" : "Off");
  }

  async function sendDisplayList(context) {
    try {
      const result = await runWindowsDisplayControl("list");
      api.sendToPropertyInspector?.(
        {
          type: "displayList",
          displays: result.displays || [],
          settings: settingsByContext.get(context)
        },
        context
      );
    } catch (error) {
      api.logMessage?.(`Monitor Toggle display discovery failed: ${error.message}`);
      api.sendToPropertyInspector?.(
        {
          type: "displayList",
          displays: [],
          settings: settingsByContext.get(context),
          error: error.message
        },
        context
      );
    }
  }

  async function handleCli(argv = process.argv) {
    if (!argv.includes("--list-displays")) {
      return false;
    }

    const result = await runWindowsDisplayControl("list");
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  function syncFromSettingsMessage(message) {
    const context = contextFrom(message);
    const settings = handleSettingsMessage(message);
    if (!settings) {
      return;
    }

    syncButtonState(context, settings).catch((error) => {
      api.logMessage?.(`Monitor Toggle state sync failed: ${error.message}`);
    });
  }

  return {
    actionUuid: MONITOR_TOGGLE_ACTION_UUID,
    name: "Monitor Toggle",
    handleCli,
    start: startDisplayWatcher,
    stop: stopDisplayWatcher,
    onConnected: startDisplayWatcher,
    onAdd: syncFromSettingsMessage,
    onParamFromPlugin: syncFromSettingsMessage,
    onParamFromApp: syncFromSettingsMessage,
    onDidReceiveSettings: syncFromSettingsMessage,
    onSendToPlugin(message = {}) {
      const context = contextFrom(message);
      const payload = message?.payload || {};

      if (payload.type === "listDisplays") {
        sendDisplayList(context);
      }
    },
    onRun(message = {}) {
      const context = contextFrom(message);
      const settings = currentSettings(message);
      if (!settings.targetKeys.length && !hasSettingsPayload(settingsFrom(message)) && !settingsByContext.has(context)) {
        pendingRunsByContext.set(context, true);
        requestSavedSettings(context);
        return;
      }

      toggle(context, settings).catch((error) => {
        api.logMessage?.(`Monitor Toggle failed: ${error.message}`);
        api.showAlert?.(context);
      });
    }
  };
}
