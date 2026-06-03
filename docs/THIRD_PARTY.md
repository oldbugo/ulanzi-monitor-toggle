# Third-Party Files

This plugin includes Ulanzi SDK support files inside the installable plugin bundle.

## Ulanzi SDK

These folders are copied from the Ulanzi Deck Plugin SDK structure and should keep their SDK-compatible paths:

- `com.ulanzi.monitortoggle.ulanziPlugin/libs/`
- `com.ulanzi.monitortoggle.ulanziPlugin/plugin/plugin-common-node/`

They provide the property inspector UI helpers, WebSocket helpers, and Node service API used by Ulanzi Deck / Ulanzi Studio.

Project-specific code lives in:

- `com.ulanzi.monitortoggle.ulanziPlugin/plugin/app.js`
- `com.ulanzi.monitortoggle.ulanziPlugin/property-inspector/inspector.html`
- `com.ulanzi.monitortoggle.ulanziPlugin/scripts/WindowsDisplayControl.ps1`
- `com.ulanzi.monitortoggle.ulanziPlugin/scripts/WindowsDisplayWatcher.ps1`
