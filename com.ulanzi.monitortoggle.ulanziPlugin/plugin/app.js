import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const displayCtlPath = path.join(pluginRoot, "scripts", "DisplayCtl.ps1");
const stateRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "UlanziMonitorToggle");

let UlanziApi;
const devCliMode = process.argv.includes("--list-displays");

try {
  UlanziApi = (await import("./plugin-common-node/index.js")).default;
} catch (error) {
  if (!devCliMode) {
    throw error;
  }

  UlanziApi = class DevUlanziApi {
    connect() {}
    onAdd() {}
    onRun() {}
    onConnected(callback) {
      callback?.();
    }
    setStateIcon(_context, state, title) {
      console.log(JSON.stringify({ event: "setStateIcon", state, title }));
    }
    setBaseDataIcon(_context, data, title) {
      console.log(JSON.stringify({ event: "setBaseDataIcon", dataLength: data.length, title }));
    }
    showAlert(context) {
      console.warn(JSON.stringify({ event: "showAlert", context }));
    }
    logMessage(message) {
      console.log(message);
    }
  };
}

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.monitortoggle";
const ACTION_UUID = `${PLUGIN_UUID}.toggle`;
const $UD = new UlanziApi();
const settingsByContext = new Map();

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

function snapshotPathFor(context) {
  const stableName = String(context || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(stateRoot, `${ACTION_UUID}.${stableName}.full-layout.bin`);
}

function contextFrom(message = {}) {
  return message.context || message.action || "";
}

function settingsFrom(message = {}) {
  return message.param || message.settings || {};
}

function cacheSettings(message = {}) {
  const context = contextFrom(message);
  if (!context) {
    return normalizeSettings(settingsFrom(message));
  }

  const settings = normalizeSettings(settingsFrom(message));
  settingsByContext.set(context, settings);
  return settings;
}

function currentSettings(message = {}) {
  const context = contextFrom(message);
  const incoming = settingsFrom(message);

  if (incoming && Object.keys(incoming).length > 0) {
    return cacheSettings(message);
  }

  return settingsByContext.get(context) || normalizeSettings({});
}

function runDisplayCtl(action, options = {}) {
  fs.mkdirSync(stateRoot, { recursive: true });

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    displayCtlPath,
    "-Action",
    action
  ];

  if (options.targetKeys?.length) {
    args.push("-TargetKeys", options.targetKeys.join(","));
  }

  if (options.snapshotPath) {
    args.push("-SnapshotPath", options.snapshotPath);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `DisplayCtl exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`DisplayCtl returned invalid JSON: ${error.message}\n${stdout}`));
      }
    });
  });
}

async function syncButtonState(context, settings) {
  if (!settings.targetKeys.length) {
    return;
  }

  const result = await runDisplayCtl("is-active", {
    targetKeys: settings.targetKeys
  });
  const active = Boolean(result.active);
  setButtonIcon(context, settings, active);
}

async function toggle(context, rawSettings) {
  const settings = normalizeSettings(rawSettings);

  if (!settings.targetKeys.length) {
    $UD.showAlert?.(context);
    $UD.logMessage?.("Monitor Toggle: no target keys configured.");
    return;
  }

  const result = await runDisplayCtl("toggle", {
    targetKeys: settings.targetKeys,
    snapshotPath: snapshotPathFor(context)
  });
  const active = Boolean(result.active);
  setButtonIcon(context, settings, active);
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

function setButtonIcon(context, settings, active) {
  if (typeof $UD.setBaseDataIcon !== "function") {
    $UD.setStateIcon(context, active ? 0 : 1, active ? "On" : "Off");
    return;
  }

  const data = svgBase64(generateIconSvg(settings, active));
  $UD.setBaseDataIcon(context, data, active ? "On" : "Off");
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

async function sendDisplayList(context) {
  try {
    const result = await runDisplayCtl("list");
    $UD.sendToPropertyInspector?.(
      {
        type: "displayList",
        displays: result.displays || [],
        settings: settingsByContext.get(context)
      },
      context
    );
  } catch (error) {
    $UD.logMessage?.(`Monitor Toggle display discovery failed: ${error.message}`);
    $UD.sendToPropertyInspector?.(
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

if (process.argv.includes("--list-displays")) {
  const result = await runDisplayCtl("list");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

$UD.connect(PLUGIN_UUID);

$UD.onAdd?.((message) => {
  const context = contextFrom(message);
  const settings = cacheSettings(message);
  syncButtonState(context, settings).catch((error) => {
    $UD.logMessage?.(`Monitor Toggle state sync failed: ${error.message}`);
  });
});

$UD.onParamFromPlugin?.((message) => {
  const context = contextFrom(message);
  const settings = cacheSettings(message);
  syncButtonState(context, settings).catch((error) => {
    $UD.logMessage?.(`Monitor Toggle state sync failed: ${error.message}`);
  });
});

$UD.onParamFromApp?.((message) => {
  const context = contextFrom(message);
  const settings = cacheSettings(message);
  syncButtonState(context, settings).catch((error) => {
    $UD.logMessage?.(`Monitor Toggle state sync failed: ${error.message}`);
  });
});

$UD.onDidReceiveSettings?.((message) => {
  const context = contextFrom(message);
  const settings = cacheSettings(message);
  syncButtonState(context, settings).catch((error) => {
    $UD.logMessage?.(`Monitor Toggle state sync failed: ${error.message}`);
  });
});

$UD.onSendToPlugin?.((message) => {
  const context = contextFrom(message);
  const payload = message?.payload || {};

  if (payload.type === "listDisplays") {
    sendDisplayList(context);
  }
});

$UD.onRun?.((message) => {
  const context = contextFrom(message);
  toggle(context, currentSettings(message)).catch((error) => {
    $UD.logMessage?.(`Monitor Toggle failed: ${error.message}`);
    $UD.showAlert?.(context);
  });
});
