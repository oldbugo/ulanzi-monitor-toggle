import { createRuntimePaths } from "./src/runtime/paths.js";
import { createUtilitySuite } from "./src/suite/createUtilitySuite.js";
import { PLUGIN_UUID } from "./src/suite/identifiers.js";
import { createMonitorToggleUtility } from "./src/utilities/monitorToggle/index.js";

let UlanziApi;
const devCliMode = process.argv.includes("--list-displays");

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
    createMonitorToggleUtility({ api, paths })
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
