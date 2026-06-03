export function contextFrom(message = {}) {
  return message.context || message.action || "";
}

export function settingsFrom(message = {}) {
  return message.param || message.settings || {};
}

export function actionUuidFrom(message = {}) {
  const context = contextFrom(message);
  if (context) {
    return String(context).split("___")[0] || "";
  }

  return message.uuid || "";
}
