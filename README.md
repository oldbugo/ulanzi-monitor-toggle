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
5. Keep animation set to `Transition` unless you want static-only icons.
6. Use `Auto status` first. If it reports unsupported, switch to `Manual`.
7. In manual mode, enter the remaining percentage and reset time.

The monitor refreshes when the key is pressed. It does not decrement usage or run model requests.

Displayed percentages always mean allowance left. `100%` means the full window is available; `30%` means `70%` has been used.

AI Allowance Monitor uses five visual bands for the remaining allowance:

- `full`: 100-76
- `healthy`: 75-51
- `caution`: 50-26
- `warning`: 25-11
- `critical`: 10-0

Provider-specific backgrounds and transition GIFs can be added under:

```text
resources/actions/ai-allowance/backgrounds/shared/<band>.png
resources/actions/ai-allowance/backgrounds/codex/<band>.svg|png|jpg|jpeg|webp
resources/actions/ai-allowance/backgrounds/claude/<band>.svg|png|jpg|jpeg|webp
resources/actions/ai-allowance/transitions/codex/<band>.gif
resources/actions/ai-allowance/transitions/claude/<band>.gif
```

Static backgrounds should be square, textless full-background images. Provider-specific assets win first, then `backgrounds/shared` is used for both providers. Raster images are scaled into the 144x144 generated icon, but exporting them near 144x144 keeps Ulanzi icon updates lightweight. Transition GIFs should be 144x144 full-background animations for entering a band. Missing static assets fall back to generated band colors, and missing GIFs simply skip the transition.

Auto status is best-effort because providers do not expose a stable public API for personal Pro-plan allowance. Current sources:

- Codex: reads the existing local Codex ChatGPT auth file at `%USERPROFILE%\.codex\auth.json`, calls the ChatGPT allowance endpoint, and caches only the normalized allowance snapshot.
- Claude: reads `CLAUDE_CODE_OAUTH_TOKEN`, or Claude Code OAuth credentials from `%USERPROFILE%\.claude\.credentials.json` / `CLAUDE_CONFIG_DIR`, then calls Anthropic's OAuth usage endpoint.
- Claude Desktop for Windows: the app profile is app-container encrypted, so V1 does not read its token cache directly.

To enable Claude live status, authenticate Claude Code separately from Claude Desktop. Either run Claude Code and complete `/login`, or run `claude setup-token`, copy the printed token into a user-level `CLAUDE_CODE_OAUTH_TOKEN`, and restart Ulanzi Studio so the plugin process inherits it. When using Claude Code credentials, the monitor refreshes expired OAuth access tokens with the stored refresh token and writes the rotated token back to the same credentials file.

AI allowance cache files are stored under:

```text
%LOCALAPPDATA%\UlanziUtilitySuite\ai-allowance
```
