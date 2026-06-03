# Utility Suite Architecture

## Goal

Make the project a host for multiple personal Ulanzi Deck utilities instead of a single monitor-toggle action.

## Package Identity

- Installable bundle: `com.ulanzi.utilitysuite.ulanziPlugin`
- Plugin UUID: `com.ulanzi.ulanzistudio.utilitysuite`
- Entry point: `plugin/app.js`

## Runtime Layout

```text
plugin/
  app.js
  src/
    runtime/
      devUlanziApi.js
      messages.js
      paths.js
      powershell.js
    suite/
      createUtilitySuite.js
      identifiers.js
    utilities/
      monitorToggle/
        index.js
```

`app.js` only bootstraps the suite. Runtime helpers own shared concerns such as path resolution, PowerShell execution, dev CLI fallback, and message parsing. `createUtilitySuite` registers action UUIDs and dispatches Ulanzi events to the correct utility module.

## Utility Contract

A utility module returns an object with:

- `actionUuid`: the UUID used by `manifest.json`.
- `name`: human-readable name for logs.
- Optional lifecycle handlers: `start`, `stop`, `onConnected`.
- Optional event handlers matching Ulanzi SDK events: `onAdd`, `onRun`, `onParamFromPlugin`, `onParamFromApp`, `onDidReceiveSettings`, `onSendToPlugin`.
- Optional `handleCli(argv)` for non-destructive local commands.

## Adding Another Utility

1. Add the action UUID to `plugin/src/suite/identifiers.js`.
2. Create a module under `plugin/src/utilities/<utilityName>/`.
3. Register the module in `plugin/app.js`.
4. Add a matching action entry in `manifest.json`.
5. Add an action-specific property inspector under `property-inspector/` if the utility needs settings.
6. Put utility-specific assets under `resources/actions/<utilityName>/`.

Keep scripts and local state namespaced by utility so future tools do not share Monitor Toggle assumptions.
