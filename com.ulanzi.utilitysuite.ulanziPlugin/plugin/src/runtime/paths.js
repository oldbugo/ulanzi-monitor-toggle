import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createRuntimePaths(entryUrl) {
  const entryFile = fileURLToPath(entryUrl);
  const entryDir = path.dirname(entryFile);
  const pluginRoot = path.resolve(entryDir, "..");
  const localAppData = process.env.LOCALAPPDATA || os.tmpdir();

  return {
    entryFile,
    entryDir,
    pluginRoot,
    scriptsDir: path.join(pluginRoot, "scripts"),
    stateRoot: path.join(localAppData, "UlanziUtilitySuite"),
    legacyMonitorStateRoot: path.join(localAppData, "UlanziMonitorToggle")
  };
}
