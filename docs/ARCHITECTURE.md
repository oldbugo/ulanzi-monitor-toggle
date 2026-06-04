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
      aiAllowance/
        index.js
        model.js
        providers.js
      monitorToggle/
        index.js
```

`app.js` only bootstraps the suite. Runtime helpers own shared concerns such as path resolution, PowerShell execution, dev CLI fallback, and message parsing. `createUtilitySuite` registers action UUIDs and dispatches Ulanzi events to the correct utility module. `aiAllowance/model.js` owns shared allowance settings and status semantics; `aiAllowance/providers.js` isolates provider probing so live-status support can be added without changing the Ulanzi action runtime.

## AI Allowance Sources

The AI Allowance Monitor tracks personal subscription allowance windows, not API billing tokens. Each key can monitor one provider/window pair: Codex or Claude, and five-hour or weekly.

Auto status uses local authenticated surfaces only:

- Codex reads `%USERPROFILE%\.codex\auth.json`, uses the existing ChatGPT access token to request `https://chatgpt.com/backend-api/wham/usage`, then normalizes `primary_window` as five-hour and `secondary_window` as weekly.
- Claude reads `CLAUDE_CODE_OAUTH_TOKEN`, or Claude Code OAuth credentials from `%USERPROFILE%\.claude\.credentials.json` / `CLAUDE_CONFIG_DIR`, then requests `https://api.anthropic.com/api/oauth/usage` and normalizes the five-hour and seven-day utilization fields. When a Claude Code access token is expired or rejected with 401, the provider refreshes it through Claude Code's OAuth client and writes rotated tokens back to the same credentials file.
- Claude Desktop's Windows app profile stores auth in an app-container encrypted cache. V1 does not decrypt or scrape that profile.

The utility never stores provider credentials. It caches only normalized status snapshots under `%LOCALAPPDATA%\UlanziUtilitySuite\ai-allowance`.

`remainingPercent` is the canonical displayed percentage. Provider adapters may receive usage or utilization percentages from upstream services, but they must convert those values before rendering or caching. `100%` means the full allowance window remains; `30%` means `70%` has been used. `usedPercent` can be kept as metadata for diagnostics, but it must not be the large button percentage.

Provider usage responses are coalesced in memory for five minutes so multiple keys, such as Claude five-hour and Claude weekly, share one provider call. If a provider refresh fails after a recent successful fetch, the provider adapter can reuse the recent in-memory response while the action-level cache handles longer stale states. Scheduled refreshes run every five minutes; pressing a key still requests a refresh.

Rendering keeps visual bands separate from logical alert levels. Warning and critical alert thresholds still come from key settings, while the key background uses configurable visual thresholds with defaults matching `full` 100-80, `healthy` 79-65, `caution` 64-40, `warning` 39-20, and `critical` 19-0. The property inspector exposes `Full >=`, `Healthy >=`, `Caution >=`, `Warning >=`, and `Critical <=`; inverted visual thresholds are normalized before use. Provider-specific static SVG backgrounds are loaded from `resources/actions/ai-allowance/backgrounds/<provider>/<band>.svg` when present, then shared SVG backgrounds from `resources/actions/ai-allowance/backgrounds/shared/<band>.svg`. Missing assets fall back to generated SVG colors. Optional transition GIFs are loaded from `resources/actions/ai-allowance/transitions/<provider>/<band>.gif` only when a key enters a different known band. The final resting icon is always the generated static SVG so provider, remaining percent, reset time, and status text stay readable.

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

## Current Utilities

- `monitorToggle`: toggles Windows display topology through the PowerShell DisplayConfig backend.
- `aiAllowance`: best-effort Codex and Claude Pro allowance monitor with live local-auth status where available, plus manual five-hour and weekly reset tracking when providers do not expose readable allowance status.
