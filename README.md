# Ulanzi Utility Suite

Personal Windows utility suite for the Ulanzi D200H controller.

The suite is structured as one JavaScript plugin with multiple registered utilities. The first utility is **Monitor Toggle**, which disables or re-enables selected Windows displays from the active desktop topology.

## Current Utilities

- Monitor Toggle: toggle a single monitor or a monitor group from a D200H key.
- Monitor Toggle: discover active Windows displays in the property inspector.
- Monitor Toggle: refresh configured button icons after display changes.
- Monitor Toggle: generate custom dock icons from SVG presets and user-selected colors.

## Requirements

- Windows 11 target system.
- Ulanzi Deck / Ulanzi Studio with JavaScript plugin support.
- Ulanzi D200H controller.
- Node.js available to the plugin runtime.
- `powershell.exe` available and allowed to run scripts.

The manifest is Windows-only and currently targets D200H keypad actions.

## Repository Layout

```text
ulanzi-monitor-toggle/
  README.md
  package.json
  docs/
    ARCHITECTURE.md
    PLAN.md
    VERIFICATION.md
    THIRD_PARTY.md
  com.ulanzi.utilitysuite.ulanziPlugin/
    manifest.json
    package.json
    plugin/
      app.js
      src/
        runtime/
        suite/
        utilities/
          monitorToggle/
      plugin-common-node/
    property-inspector/
      monitor-toggle.html
    scripts/
      WindowsDisplayControl.ps1
      WindowsDisplayWatcher.ps1
    resources/
      actions/
        toggle/
```

## Setup

Install plugin dependencies from the repository root:

```powershell
npm run install:plugin
```

Run the non-destructive checks:

```powershell
npm run validate:json
npm run backend:list
npm run node:list
```

`backend:list` and `node:list` only enumerate active displays. They do not disable, enable, restore, or toggle monitors.

Copy the plugin into the local Ulanzi plugin folder:

```powershell
$source = Resolve-Path .\com.ulanzi.utilitysuite.ulanziPlugin
$destination = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\Plugins\com.ulanzi.utilitysuite.ulanziPlugin'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -Path (Join-Path $source.Path '*') -Destination $destination -Recurse -Force
```

Restart Ulanzi Deck after copying the plugin so the JavaScript service and PowerShell backend reload.

## Configure Monitor Toggle

1. Open Ulanzi Deck.
2. Add `Ulanzi Utility Suite: Monitor Toggle` to a D200H key.
3. Choose `Single monitor` or `Monitor group`.
4. Select the monitor or monitors from the dropdown list.
5. Optional: adjust the generated icon style and colors.
6. Press the physical key to toggle the selected monitor set.

Snapshot files for Monitor Toggle are stored under:

```text
%LOCALAPPDATA%\UlanziUtilitySuite\monitor-toggle
```

The utility also checks the legacy `%LOCALAPPDATA%\UlanziMonitorToggle` snapshot folder when restoring a monitor.
