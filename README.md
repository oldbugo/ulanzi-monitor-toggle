# Ulanzi Monitor Toggle

Windows monitor toggle plugin for the Ulanzi D200H controller.

The plugin lets a Ulanzi key disable or re-enable selected Windows displays from the active desktop topology. It can target one monitor or a configured monitor group, and the dock icon shows whether the selected monitor set is currently active or inactive.

This project avoids bundling a native executable. The JavaScript plugin calls a source-visible PowerShell script, which compiles an in-memory C# wrapper around documented Windows DisplayConfig APIs.

## Features

- Toggle a single monitor on or off from a D200H key.
- Toggle a group of monitors from one key.
- Automatically discover active Windows displays in the property inspector.
- Configure monitor groups with multiple dropdown rows.
- Restore individual monitors from a group-created snapshot.
- Refresh all configured button icons after a toggle, so group and individual buttons stay in sync.
- Generate custom dock icons from SVG presets and user-selected colors.
- Preserve display topology as much as Windows allows, including position, resolution, refresh rate, rotation, and primary display state.
- Refuse to disable every active display.

## Requirements

- Windows 11 target system.
- Ulanzi Deck / Ulanzi Studio with JavaScript plugin support.
- Ulanzi D200H controller.
- Node.js available to the plugin runtime.
- `powershell.exe` available and allowed to run scripts.

The manifest is Windows-only and targets the D200H keypad action.

## Repository Layout

```text
ulanzi-monitor-toggle/
  README.md
  PLAN.md
  VERIFICATION.md
  package.json
  com.ulanzi.monitortoggle.ulanziPlugin/
    manifest.json
    package.json
    plugin/
      app.js
      plugin-common-node/
    property-inspector/
      inspector.html
    scripts/
      DisplayCtl.ps1
    resources/
      actions/
        toggle/
          on.svg
          off.svg
```

## Setup

Clone the repository, then run these commands from the repository root:

```powershell
npm run install:plugin
npm run validate:json
npm run backend:list
npm run node:list
```

`backend:list` and `node:list` are non-destructive. They should print JSON describing the currently active displays.

To install the plugin into the local Ulanzi plugin folder:

```powershell
$source = Resolve-Path .\com.ulanzi.monitortoggle.ulanziPlugin
$destination = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\Plugins\com.ulanzi.monitortoggle.ulanziPlugin'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -Path (Join-Path $source.Path '*') -Destination $destination -Recurse -Force
```

Restart Ulanzi Deck after copying the plugin so the JavaScript service and PowerShell backend reload.

## Configure A Button

1. Open Ulanzi Deck.
2. Add `Monitor Toggle: Toggle Monitor` to a D200H key.
3. Choose `Single monitor` or `Monitor group`.
4. Select the monitor or monitors from the dropdown list.
5. Optional: adjust the generated icon style and colors.
6. Press the physical key to toggle the selected monitor set.

For monitor groups, use `Add monitor` to add another dropdown row. Use the delete button beside a row to remove it.

## How Toggling Works

When a configured monitor is active, pressing the key disables that display path from Windows and saves the current full display layout to a local snapshot file.

When a configured monitor is inactive, pressing the key restores the selected monitor from a saved snapshot. If the current button does not own the relevant snapshot, the plugin searches other recent Monitor Toggle snapshots. This allows an individual monitor button to re-enable a monitor that was disabled by a group button.

Snapshot files are stored under:

```text
%LOCALAPPDATA%\UlanziMonitorToggle
```

Snapshots are removed after all displays from the saved layout are active again.

## Backend Commands

The PowerShell backend is at:

```text
com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1
```

Useful commands:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1 -Action list
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1 -Action is-active -TargetKeys "<display-key>"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1 -Action disable -TargetKeys "<display-key>" -SnapshotPath "$env:TEMP\monitor-toggle-test.bin"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1 -Action enable -TargetKeys "<display-key>" -SnapshotPath "$env:TEMP\monitor-toggle-test.bin"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1 -Action restore -SnapshotPath "$env:TEMP\monitor-toggle-test.bin"
```

Start with `list`. Do not manually test `disable` against your only active display. The backend has a guard against disabling every active display, but first real tests should target a non-critical monitor.

## Verification

Recommended checks after changes:

```powershell
npm run validate:json
npm run backend:list
npm run node:list
```

Manual dock checks:

- Single-monitor toggle turns the selected monitor off and back on.
- Group toggle turns all selected monitors off and back on.
- Individual buttons update their icon state after a group toggle.
- An individual button can re-enable a monitor that was turned off by a group toggle.
- Icon preset and color changes render on the dock.

## Known Limitations

- Windows may move application windows when monitors are disabled. This project currently restores display topology, not individual application window positions.
- Status updates are event-driven. The plugin refreshes on setup changes, inspector events, and plugin toggles; display changes made outside the plugin may require reopening the inspector, refreshing monitors, or pressing a configured key.
- PowerShell execution policies or enterprise endpoint controls can block the backend.
- Docking stations, indirect displays, or hotplug events may change display target identifiers. Re-select monitors if the dropdown no longer maps to the expected physical display.
- Marketplace acceptance is not guaranteed. The package avoids a bundled `.exe`, but it still launches PowerShell and uses Windows APIs.
