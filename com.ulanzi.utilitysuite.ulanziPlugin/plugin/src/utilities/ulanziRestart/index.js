import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { contextFrom } from "../../runtime/messages.js";
import { powershellFileArgs, runJsonPowerShell } from "../../runtime/powershell.js";
import { ULANZI_RESTART_ACTION_UUID } from "../../suite/identifiers.js";

function svgBase64(svg) {
  return Buffer.from(svg, "utf8").toString("base64");
}

function iconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="#172554"/>
  <path d="M104 46a41 41 0 1 0 7 49" fill="none" stroke="#bfdbfe" stroke-width="12" stroke-linecap="round"/>
  <path d="M100 24v29H71" fill="none" stroke="#60a5fa" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="72" y="124" text-anchor="middle" fill="#eff6ff" font-family="Arial, sans-serif" font-size="18" font-weight="700">Restart</text>
</svg>`;
}

function restartingSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="#0f172a"/>
  <path d="M104 46a41 41 0 1 0 7 49" fill="none" stroke="#93c5fd" stroke-width="12" stroke-linecap="round"/>
  <path d="M100 24v29H71" fill="none" stroke="#facc15" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="72" y="124" text-anchor="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="17" font-weight="700">Restarting</text>
</svg>`;
}

function truncateLogValue(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 800) {
    return normalized;
  }

  return `${normalized.slice(0, 797)}...`;
}

export function createUlanziRestartUtility({ api, paths }) {
  const scriptPath = path.join(paths.scriptsDir, "RestartUlanziStudio.ps1");
  const stateRoot = path.join(paths.stateRoot, "ulanzi-restart");
  const logPath = path.join(stateRoot, "restart.log");
  let lastTriggerAt = 0;

  function appendLog(message) {
    try {
      fs.mkdirSync(stateRoot, { recursive: true });
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
    } catch {
    }
  }

  function setIcon(context, restarting = false) {
    if (typeof api.setBaseDataIcon === "function") {
      api.setBaseDataIcon(context, svgBase64(restarting ? restartingSvg() : iconSvg()), restarting ? "Restarting" : "Restart");
      return;
    }

    api.setStateIcon?.(context, restarting ? 1 : 0, restarting ? "Restarting" : "Restart");
  }

  function launchRestartHelper({ delaySeconds = 1, dryRun = false, waitForExit = false } = {}) {
    const helperArgs = powershellFileArgs(scriptPath, [
      "-DelaySeconds",
      String(delaySeconds),
      "-LogPath",
      logPath,
      ...(dryRun ? ["-DryRun"] : [])
    ]);

    appendLog(`helper launch requested with script ${scriptPath}; dryRun=${dryRun}; waitForExit=${waitForExit}`);
    const child = spawn(
      "powershell.exe",
      helperArgs,
      {
        detached: false,
        stdio: waitForExit ? ["ignore", "pipe", "pipe"] : "ignore",
        windowsHide: true
      }
    );

    appendLog(`helper process spawned pid=${child.pid || ""}`);

    if (!waitForExit) {
      child.on("error", (error) => {
        appendLog(`helper launch failed: ${error.message}`);
        api.logMessage?.(`Ulanzi Restart helper launch failed: ${error.message}`);
      });
      child.unref();
      return undefined;
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      appendLog(`helper stderr: ${truncateLogValue(chunk)}`);
    });

    const completion = new Promise((resolve, reject) => {
      child.on("error", (error) => {
        appendLog(`helper launch failed: ${error.message}`);
        api.logMessage?.(`Ulanzi Restart helper launch failed: ${error.message}`);
        reject(error);
      });

      child.on("close", (code, signal) => {
        appendLog(`helper process closed with code=${code}; signal=${signal || ""}`);
        if (stdout.trim()) {
          appendLog(`helper stdout: ${truncateLogValue(stdout)}`);
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
          return;
        }

        resolve(stdout);
      });
    });

    if (!waitForExit) {
      completion.catch(() => {});
      return undefined;
    }

    return completion;
  }

  async function dryRun() {
    return runJsonPowerShell(scriptPath, ["-DryRun"]);
  }

  async function launchDryRun() {
    const stdout = await launchRestartHelper({
      delaySeconds: 0,
      dryRun: true,
      waitForExit: true
    });

    return JSON.parse(stdout);
  }

  function triggerRestart(message, eventName) {
    const now = Date.now();
    if (now - lastTriggerAt < 5000) {
      appendLog(`ignored duplicate ${eventName} event`);
      return;
    }

    lastTriggerAt = now;
    const context = contextFrom(message);
    appendLog(`received ${eventName} event for ${context || "unknown context"}`);

    try {
      setIcon(context, true);
    } catch (error) {
      appendLog(`icon update failed: ${error.message}`);
      api.logMessage?.(`Ulanzi Restart icon update failed: ${error.message}`);
    }

    try {
      launchRestartHelper();
    } catch (error) {
      appendLog(`helper launch threw: ${error.message}`);
      api.logMessage?.(`Ulanzi Restart helper launch failed: ${error.message}`);
      api.showAlert?.(context);
    }
  }

  return {
    actionUuid: ULANZI_RESTART_ACTION_UUID,
    name: "Ulanzi Restart",
    onAdd(message) {
      setIcon(contextFrom(message));
    },
    onDidReceiveSettings(message) {
      setIcon(contextFrom(message));
    },
    onKeyDown(message) {
      triggerRestart(message, "keydown");
    },
    onRun(message) {
      triggerRestart(message, "run");
    },
    async handleCli(argv = process.argv) {
      if (argv.includes("--restart-ulanzi-launch-dry-run")) {
        console.log(JSON.stringify(await launchDryRun(), null, 2));
        return true;
      }

      if (argv.includes("--restart-ulanzi-dry-run")) {
        console.log(JSON.stringify(await dryRun(), null, 2));
        return true;
      }

      return false;
    }
  };
}
