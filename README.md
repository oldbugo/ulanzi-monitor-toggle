# Ulanzi Utility Suite

Personal Windows utility suite for the Ulanzi D200H controller.

The suite is structured as one JavaScript plugin with multiple registered utilities. The first utility is **Monitor Toggle**, which disables or re-enables selected Windows displays from the active desktop topology.

## Current Utilities

- Monitor Toggle: toggle a single monitor or a monitor group from a D200H key.
- Monitor Toggle: discover active Windows displays in the property inspector.
- Monitor Toggle: refresh configured button icons after display changes.
- Monitor Toggle: generate custom dock icons from SVG presets and user-selected colors.
- AI Allowance Monitor: track Codex and Claude Pro allowance windows, with manual fallback when local authenticated status surfaces are unavailable.

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
          aiAllowance/
      plugin-common-node/
    property-inspector/
      ai-allowance.html
      monitor-toggle.html
    scripts/
      WindowsDisplayControl.ps1
      WindowsDisplayWatcher.ps1
    resources/
      actions/
        ai-allowance/
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
npm run ai-allowance:codex
npm run ai-allowance:claude
npm run test:ai-allowance
```

`backend:list` and `node:list` only enumerate active displays. `ai-allowance:*` checks local authenticated status surfaces and does not run model requests or spend AI provider allowance. None of these commands disable, enable, restore, or toggle monitors.

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

## Configure AI Allowance Monitor

1. Open Ulanzi Deck.
2. Add `Ulanzi Utility Suite: AI Allowance Monitor` to a D200H key.
3. Choose `Codex` or `Claude`.
4. Choose `Five hour` or `Weekly`.
5. Use `Auto status` first. If it reports unsupported, switch to `Manual`.
6. In manual mode, enter the remaining percentage and reset time.

The monitor refreshes when the key is pressed. It does not decrement usage or run model requests.

Auto status is best-effort because providers do not expose a stable public API for personal Pro-plan allowance. Current sources:

- Codex: reads the existing local Codex ChatGPT auth file at `%USERPROFILE%\.codex\auth.json`, calls the ChatGPT allowance endpoint, and caches only the normalized allowance snapshot.
- Claude: reads Claude Code OAuth credentials from `%USERPROFILE%\.claude\.credentials.json` or `CLAUDE_CONFIG_DIR` when available, then calls Anthropic's OAuth usage endpoint.
- Claude Desktop for Windows: the app profile is app-container encrypted, so V1 does not read its token cache directly.

AI allowance cache files are stored under:

```text
%LOCALAPPDATA%\UlanziUtilitySuite\ai-allowance
```
