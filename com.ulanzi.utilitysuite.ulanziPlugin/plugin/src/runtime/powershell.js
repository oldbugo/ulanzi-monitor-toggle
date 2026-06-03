import { spawn } from "node:child_process";

export function powershellFileArgs(scriptPath, scriptArgs = [], options = {}) {
  const args = ["-NoProfile"];

  if (options.sta) {
    args.push("-STA");
  }

  args.push("-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs);
  return args;
}

export function runJsonPowerShell(scriptPath, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", powershellFileArgs(scriptPath, scriptArgs), {
      windowsHide: true
    });
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
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`PowerShell returned invalid JSON: ${error.message}\n${stdout}`));
      }
    });
  });
}
