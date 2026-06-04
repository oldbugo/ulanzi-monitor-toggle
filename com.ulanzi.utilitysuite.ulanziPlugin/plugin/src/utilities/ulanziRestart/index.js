import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { contextFrom } from "../../runtime/messages.js";
import { powershellFileArgs } from "../../runtime/powershell.js";
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

function psStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
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

  function helperCommandLine({ delaySeconds = 1, dryRun = false } = {}) {
    const helperArgs = [
      "powershell.exe",
      ...powershellFileArgs(scriptPath, [
        "-DelaySeconds",
        String(delaySeconds),
        "-LogPath",
        logPath,
        ...(dryRun ? ["-DryRun"] : [])
      ])
    ];

    return helperArgs.map(windowsCommandArg).join(" ");
  }

  function launchRestartHelper({ delaySeconds = 1, dryRun = false, waitForExit = false } = {}) {
    const commandLine = helperCommandLine({ delaySeconds, dryRun });
    const launchCommand = [
      "$ErrorActionPreference = 'Stop'",
      `$commandLine = ${psStringLiteral(commandLine)}`,
      "$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }",
      "$returnValue = [int]$result.ReturnValue",
      "if ($returnValue -ne 0) { throw \"Win32_Process.Create failed with returnValue=$returnValue\" }",
      "[pscustomobject]@{ returnValue = $returnValue; processId = [int]$result.ProcessId; commandLine = $commandLine } | ConvertTo-Json -Compress"
    ].join("; ");
    const launcherArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      launchCommand
    ];

    appendLog(`helper launch requested via cim with script ${scriptPath}; dryRun=${dryRun}; waitForExit=${waitForExit}`);
    const child = spawn(
      "powershell.exe",
      launcherArgs,
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    appendLog(`helper launcher spawned pid=${child.pid || ""}`);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      appendLog(`helper launcher stderr: ${truncateLogValue(chunk)}`);
    });

    const completion = new Promise((resolve, reject) => {
      child.on("error", (error) => {
        appendLog(`helper launcher failed: ${error.message}`);
        api.logMessage?.(`Ulanzi Restart helper launch failed: ${error.message}`);
        reject(error);
      });

      child.on("close", (code, signal) => {
        appendLog(`helper launcher closed with code=${code}; signal=${signal || ""}`);
        if (stdout.trim()) {
          appendLog(`helper launcher stdout: ${truncateLogValue(stdout)}`);
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `PowerShell launcher exited with code ${code}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`PowerShell launcher returned invalid JSON: ${error.message}`));
        }
      });
    });

    if (!waitForExit) {
      completion.catch(() => {});
      child.unref();
      return undefined;
    }

    return completion;
  }

  function launchRestartHelperDirect({ delaySeconds = 1, dryRun = false } = {}) {
    const helperArgs = powershellFileArgs(scriptPath, [
      "-DelaySeconds",
      String(delaySeconds),
      "-LogPath",
      logPath,
      ...(dryRun ? ["-DryRun"] : [])
    ]);

    appendLog(`helper direct launch requested with script ${scriptPath}; dryRun=${dryRun}`);
    const child = spawn(
      "powershell.exe",
      helperArgs,
      {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    appendLog(`helper direct process spawned pid=${child.pid || ""}`);

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
        appendLog(`helper direct launch failed: ${error.message}`);
        api.logMessage?.(`Ulanzi Restart helper launch failed: ${error.message}`);
        reject(error);
      });

      child.on("close", (code, signal) => {
        appendLog(`helper direct process closed with code=${code}; signal=${signal || ""}`);
        if (stdout.trim()) {
          appendLog(`helper direct stdout: ${truncateLogValue(stdout)}`);
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
          return;
        }

        resolve(stdout);
      });
    });

    return completion;
  }

  async function dryRun() {
    const stdout = await launchRestartHelperDirect({
      delaySeconds: 0,
      dryRun: true
    });

    return JSON.parse(stdout);
  }

  async function launchDryRun() {
    return launchRestartHelper({
      delaySeconds: 0,
      dryRun: true,
      waitForExit: true
    });
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
