export class DevUlanziApi {
  connect() {}
  onAdd() {}
  onRun() {}
  onConnected(callback) {
    callback?.();
    return this;
  }
  onParamFromPlugin() {
    return this;
  }
  onParamFromApp() {
    return this;
  }
  onDidReceiveSettings() {
    return this;
  }
  onSendToPlugin() {
    return this;
  }
  getSettings(context) {
    console.log(JSON.stringify({ event: "getSettings", context }));
  }
  setStateIcon(_context, state, title) {
    console.log(JSON.stringify({ event: "setStateIcon", state, title }));
  }
  setBaseDataIcon(_context, data, title) {
    console.log(JSON.stringify({ event: "setBaseDataIcon", dataLength: data.length, title }));
  }
  setGifDataIcon(_context, gifdata, title) {
    console.log(JSON.stringify({ event: "setGifDataIcon", dataLength: gifdata.length, title }));
  }
  setGifPathIcon(_context, gifpath, title) {
    console.log(JSON.stringify({ event: "setGifPathIcon", gifpath, title }));
  }
  showAlert(context) {
    console.warn(JSON.stringify({ event: "showAlert", context }));
  }
  logMessage(message) {
    console.log(message);
  }
  sendToPropertyInspector(payload, context) {
    console.log(JSON.stringify({ event: "sendToPropertyInspector", context, payload }));
  }
}
