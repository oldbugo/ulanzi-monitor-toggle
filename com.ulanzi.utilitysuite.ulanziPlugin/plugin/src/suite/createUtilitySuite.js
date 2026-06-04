import { actionUuidFrom } from "../runtime/messages.js";

export function createUtilitySuite({ api, pluginUuid, utilities }) {
  const utilitiesByActionUuid = new Map(
    utilities.map((utility) => [utility.actionUuid, utility])
  );

  function utilityFor(message = {}) {
    const actionUuid = actionUuidFrom(message);
    if (actionUuid && utilitiesByActionUuid.has(actionUuid)) {
      return utilitiesByActionUuid.get(actionUuid);
    }

    if (utilities.length === 1) {
      return utilities[0];
    }

    return null;
  }

  function dispatch(methodName, message = {}, options = {}) {
    const utility = utilityFor(message);
    if (!utility || typeof utility[methodName] !== "function") {
      if (!options.quietMissing) {
        const actionUuid = actionUuidFrom(message) || "unknown action";
        api.logMessage?.(`Utility Suite: no handler for ${methodName} on ${actionUuid}.`);
      }
      return;
    }

    Promise.resolve(utility[methodName](message)).catch((error) => {
      api.logMessage?.(`${utility.name} failed during ${methodName}: ${error.message}`);
      if (methodName === "onRun") {
        api.showAlert?.(message.context);
      }
    });
  }

  async function handleCli(argv = process.argv) {
    for (const utility of utilities) {
      if (typeof utility.handleCli === "function" && await utility.handleCli(argv)) {
        return true;
      }
    }

    return false;
  }

  function start() {
    api.onConnected?.(() => {
      for (const utility of utilities) {
        utility.onConnected?.();
      }
    });

    api.onAdd?.((message) => dispatch("onAdd", message));
    api.onParamFromPlugin?.((message) => dispatch("onParamFromPlugin", message));
    api.onParamFromApp?.((message) => dispatch("onParamFromApp", message));
    api.onDidReceiveSettings?.((message) => dispatch("onDidReceiveSettings", message));
    api.onSendToPlugin?.((message) => dispatch("onSendToPlugin", message));
    api.onKeyDown?.((message) => dispatch("onKeyDown", message, { quietMissing: true }));
    api.onRun?.((message) => dispatch("onRun", message));

    api.connect(pluginUuid);

    for (const utility of utilities) {
      utility.start?.();
    }
  }

  function stop() {
    for (const utility of utilities) {
      utility.stop?.();
    }
  }

  return {
    handleCli,
    start,
    stop
  };
}
