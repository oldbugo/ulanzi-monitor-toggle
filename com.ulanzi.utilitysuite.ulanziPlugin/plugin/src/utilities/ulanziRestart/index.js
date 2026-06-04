import { spawn } from "node:child_process";
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

export function createUlanziRestartUtility({ api, paths }) {
  const scriptPath = path.join(paths.scriptsDir, "RestartUlanziStudio.ps1");

  function setIcon(context, restarting = false) {
    if (typeof api.setBaseDataIcon === "function") {
      api.setBaseDataIcon(context, svgBase64(restarting ? restartingSvg() : iconSvg()), restarting ? "Restarting" : "Restart");
      return;
    }

    api.setStateIcon?.(context, restarting ? 1 : 0, restarting ? "Restarting" : "Restart");
  }

  function launchRestartHelper() {
    const child = spawn(
      "powershell.exe",
      powershellFileArgs(scriptPath, ["-DelaySeconds", "1"]),
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );
    child.unref();
  }

  async function dryRun() {
    return runJsonPowerShell(scriptPath, ["-DryRun"]);
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
    onRun(message) {
      const context = contextFrom(message);
      setIcon(context, true);
      launchRestartHelper();
    },
    async handleCli(argv = process.argv) {
      if (!argv.includes("--restart-ulanzi-dry-run")) {
        return false;
      }

      console.log(JSON.stringify(await dryRun(), null, 2));
      return true;
    }
  };
}
