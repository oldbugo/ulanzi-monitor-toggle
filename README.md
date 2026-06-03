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
  package.json
  docs/
    PLAN.md
    VERIFICATION.md
    THIRD_PARTY.md
  com.ulanzi.monitortoggle.ulanziPlugin/
    manifest.json
    package.json
    plugin/
      app.js
      plugin-common-node/
    property-inspector/
      inspector.html
    scripts/
      WindowsDisplayControl.ps1
      WindowsDisplayWatcher.ps1
    resources/
      actions/
        toggle/
          on.svg
          off.svg
```

The `libs/` and `plugin/plugin-common-node/` folders are Ulanzi SDK support files copied into the installable plugin bundle. See `docs/THIRD_PARTY.md` for details.

## Setup

### Option 1: Manual Setup

Clone the repository, then install the plugin dependencies from the repository root:

```powershell
git clone https://github.com/oldbugo/ulanzi-monitor-toggle.git
cd ulanzi-monitor-toggle
```

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
Help me set up the Ulanzi Monitor Toggle plugin on Windows 11.

Repository:
https://github.com/oldbugo/ulanzi-monitor-toggle

Use the repository README as the source of truth. If useful, also read docs/PLAN.md for implementation context and docs/VERIFICATION.md for historical validation notes.

Setup constraints:
- Use PowerShell commands.
- Setup only; do not disable, enable, restore, or toggle any monitors.
- Only run non-destructive validation/list commands unless I explicitly ask for monitor toggle testing later.
- Do not use browser automation, desktop control, or GUI automation to verify setup.
- Do not take over Ulanzi Deck / Ulanzi Studio. After the command-line checks pass, give me manual UI steps instead.

Please help me:
1. Clone or locate the repository.
2. Install plugin dependencies.
3. Run the non-destructive validation/list checks from the README.
4. Copy com.ulanzi.monitortoggle.ulanziPlugin into the local Ulanzi plugin folder.
5. Tell me to restart Ulanzi Deck.
6. Stop automated verification there and provide the manual steps for adding Monitor Toggle: Toggle Monitor to a D200H key and selecting a monitor from the property inspector.

If you cannot access the repo online, ask me for the local folder path and continue from the cloned repository.
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
