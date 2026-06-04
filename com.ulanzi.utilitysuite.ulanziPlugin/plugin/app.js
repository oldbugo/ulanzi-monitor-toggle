import { createRuntimePaths } from "./src/runtime/paths.js";
import { createUtilitySuite } from "./src/suite/createUtilitySuite.js";
import { PLUGIN_UUID } from "./src/suite/identifiers.js";
import { createAiAllowanceUtility } from "./src/utilities/aiAllowance/index.js";
import { createMonitorToggleUtility } from "./src/utilities/monitorToggle/index.js";
import { createUlanziRestartUtility } from "./src/utilities/ulanziRestart/index.js";

let UlanziApi;
const devCliMode =
  process.argv.includes("--list-displays") ||
  process.argv.includes("--ai-allowance-status") ||
  process.argv.includes("--restart-ulanzi-dry-run") ||
  process.argv.includes("--restart-ulanzi-launch-dry-run");

try {
  UlanziApi = (await import("./plugin-common-node/index.js")).default;
} catch (error) {
  if (!devCliMode) {
    throw error;
  }

  UlanziApi = (await import("./src/runtime/devUlanziApi.js")).DevUlanziApi;
}

const api = new UlanziApi();
const paths = createRuntimePaths(import.meta.url);
const suite = createUtilitySuite({
  api,
  pluginUuid: PLUGIN_UUID,
  utilities: [
    createMonitorToggleUtility({ api, paths }),
    createAiAllowanceUtility({ api, paths }),
    createUlanziRestartUtility({ api, paths })
  ]
});

if (await suite.handleCli(process.argv)) {
  process.exit(0);
}

suite.start();

process.on("exit", suite.stop);
process.on("SIGINT", () => {
  suite.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  suite.stop();
  process.exit(0);
});
