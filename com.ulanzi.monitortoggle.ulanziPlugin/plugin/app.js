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

function normalizeSettings(raw = {}) {
  const targetKeys = String(raw.targetKeys || "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    mode: raw.mode === "group" ? "group" : "single",
    targetKeys
  };
}

function snapshotPathFor(context) {
  const stableName = String(context || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(stateRoot, `${ACTION_UUID}.${stableName}.bin`);
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
  $UD.setStateIcon(context, active ? 0 : 1, active ? "On" : "Off");
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
  $UD.setStateIcon(context, active ? 0 : 1, active ? "On" : "Off");
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
