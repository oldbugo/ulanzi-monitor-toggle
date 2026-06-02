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

### Option 1: Manual Setup

Clone the repository, then install the plugin dependencies from the repository root:

```powershell
npm run install:plugin
```

Run the non-destructive setup checks:

```powershell
npm run validate:json
npm run backend:list
npm run node:list
```

`backend:list` and `node:list` are non-destructive. They should print JSON describing the currently active displays.

Copy the plugin into the local Ulanzi plugin folder:

```powershell
$source = Resolve-Path .\com.ulanzi.monitortoggle.ulanziPlugin
$destination = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\Plugins\com.ulanzi.monitortoggle.ulanziPlugin'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -Path (Join-Path $source.Path '*') -Destination $destination -Recurse -Force
```

Restart Ulanzi Deck after copying the plugin so the JavaScript service and PowerShell backend reload.

### Option 2: AI-Assisted Setup

Copy and paste this prompt into your AI assistant of choice:

```text
I want help setting up the Ulanzi Monitor Toggle plugin on Windows 11.

Project context:
- This is a Windows-only Ulanzi D200H JavaScript plugin.
- The plugin package folder is named com.ulanzi.monitortoggle.ulanziPlugin.
- The plugin disables and re-enables Windows displays using a source-visible PowerShell backend at com.ulanzi.monitortoggle.ulanziPlugin\scripts\DisplayCtl.ps1.
- It does not bundle a native executable.
- Setup should not disable or toggle any monitors. Only run non-destructive validation/list commands.
- The local Ulanzi plugin install folder should be %APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.monitortoggle.ulanziPlugin.

Please guide me through setup by doing the following:
1. Confirm I am in the repository root that contains package.json and the com.ulanzi.monitortoggle.ulanziPlugin folder.
2. Run npm run install:plugin.
3. Run npm run validate:json.
4. Run npm run backend:list and confirm it returns JSON for active displays.
5. Run npm run node:list and confirm the Node service can call the backend.
6. Copy com.ulanzi.monitortoggle.ulanziPlugin into %APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.monitortoggle.ulanziPlugin.
7. Tell me to restart Ulanzi Deck.
8. After restart, help me add Monitor Toggle: Toggle Monitor to a D200H key and select a monitor from the property inspector.

Use PowerShell commands. Do not run DisplayCtl.ps1 with disable, enable, restore, or toggle unless I explicitly ask after setup is complete.
```

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
