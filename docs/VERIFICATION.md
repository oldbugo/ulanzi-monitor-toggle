# Verification Log

## 2026-06-04

Environment:

- Branch: `codex/utility-suite-foundation`
- Claude Code version: `2.1.161 (Claude Code)`
- Plugin package folder: `com.ulanzi.utilitysuite.ulanziPlugin`

Investigation:

| Check | Result |
| --- | --- |
| Claude env token | `CLAUDE_CODE_OAUTH_TOKEN` was not set |
| Claude Code credentials | `%USERPROFILE%\.claude\.credentials.json` existed and contained Claude Code OAuth credentials |
| Claude access token expiry | Existing access token was expired; expiry was `2026-06-04T04:26:28+10:00` |
| Raw Claude usage probe before fix | Returned HTTP `429` with `Rate limited. Please try again later.` |
| Installed plugin copy | Installed `providers.js` matched repository hash before the fix |

Fixes verified:

| Check | Command | Result |
| --- | --- | --- |
| Provider syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\utilities\aiAllowance\providers.js` | Passed |
| Index syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\utilities\aiAllowance\index.js` | Passed |
| AI allowance unit tests | `npm run test:ai-allowance` | Passed; 10 `node:test` cases |
| JSON parse | `npm run validate:json` | Passed |
| Claude five-hour allowance CLI | `npm run ai-allowance:claude` | Passed; returned `live`; 26% remaining, 74% used; reset at `2026-06-04T06:30:01.074Z` |
| Claude weekly allowance CLI | `node .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\app.js --ai-allowance-status claude --window weekly` | Passed; returned `live`; 58% remaining, 42% used; reset at `2026-06-06T17:00:00.921Z` |
| Codex allowance CLI | `npm run ai-allowance:codex` | Passed; returned `live`; 78% remaining, 22% used |

Outcome: Claude sync failure was caused by an expired Claude Code OAuth access token plus repeated usage polling after restart. The provider now refreshes expired Claude Code OAuth tokens with the stored refresh token, writes the rotated token back to `%USERPROFILE%\.claude\.credentials.json`, coalesces provider usage calls for five minutes, and uses a five-minute scheduled refresh interval.

Granular AI allowance backgrounds verified:

| Check | Command | Result |
| --- | --- | --- |
| AI allowance index syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\utilities\aiAllowance\index.js` | Passed |
| AI allowance model syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\utilities\aiAllowance\model.js` | Passed |
| Dev Ulanzi API syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\runtime\devUlanziApi.js` | Passed |
| AI allowance unit tests | `npm run test:ai-allowance` | Passed; 19 `node:test` cases, including visual band boundaries, custom visual thresholds, legacy visual threshold migration, static asset fallback, provider and shared SVG background loading, raster fallback behavior, and transition animation gating |
| JSON parse | `npm run validate:json` | Passed |
| Codex allowance CLI | `npm run ai-allowance:codex` | Passed; returned `live`; 45% remaining, 55% used |
| Claude allowance CLI | `npm run ai-allowance:claude` | Passed; returned `live`; 26% remaining, 74% used |

## 2026-06-03

Environment:

- Branch: `codex/utility-suite-foundation`
- Plugin package folder: `com.ulanzi.utilitysuite.ulanziPlugin`
- Manifest UUID: `com.ulanzi.ulanzistudio.utilitysuite`

Checks performed:

| Check | Command | Result |
| --- | --- | --- |
| JSON parse | `npm run validate:json` | Passed |
| App syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\app.js` | Passed |
| Backend display list | `npm run backend:list` | Passed; returned 2 active displays |
| Node wrapper display list | `npm run node:list` | Passed; Node invoked the suite router and Monitor Toggle backend; latest run returned 2 active displays |
| AI allowance module syntax | `node --check .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\src\utilities\aiAllowance\index.js` and related module checks | Passed |
| AI allowance unit tests | `npm run test:ai-allowance` | Passed; 9 `node:test` cases, including Claude remaining-percentage display guard |
| Codex allowance CLI | `npm run ai-allowance:codex` | Passed; returned `live` with CLI version `codex-cli 0.46.0` |
| Claude allowance CLI | `npm run ai-allowance:claude` | Passed; returned `unsupported` with CLI version `2.0.14 (Claude Code)` |
| Codex weekly allowance CLI | `node .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\app.js --ai-allowance-status codex --window weekly` | Passed; returned `live` |
| Claude weekly allowance CLI | `node .\com.ulanzi.utilitysuite.ulanziPlugin\plugin\app.js --ai-allowance-status claude --window weekly` | Passed; returned `unsupported` |
| Local Ulanzi install | Copy package folder to `%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.utilitysuite.ulanziPlugin` | Passed |

## 2026-06-03 AI Allowance Monitor Preflight

Checks performed:

| Check | Command | Result |
| --- | --- | --- |
| Codex CLI help | `codex --help` | Passed; no non-interactive allowance/status command listed |
| Codex status probe | `codex help status` | Failed as expected; `status` is not a Codex CLI subcommand |
| Claude CLI help | `claude --help` | Passed; no non-interactive allowance/status command listed |
| Claude status probe | `claude status --help` | Returned generic help; no status subcommand exposed |

Additional local app checks:

| Check | Result |
| --- | --- |
| Codex Windows app package | Found `OpenAI.Codex_2p2nqsd0c76g0!App` |
| Codex desktop profile | Found app profile and Sentry evidence that the app calls `https://chatgpt.com/backend-api/wham/usage`; response bodies were not stored in plain JSON |
| Codex local auth | Found `%USERPROFILE%\.codex\auth.json`; live usage lookup succeeded without storing credentials |
| Claude Windows app package | Found `Claude_pzs8sxrjxfjjc!Claude` |
| Claude desktop profile | Found Chromium profile/token cache, but Windows app-container encryption prevents direct non-invasive token reads |
| Claude Code OAuth credentials | `%USERPROFILE%\.claude\.credentials.json` was not present, so live OAuth usage lookup could not run |
| Claude Code OAuth token env var | `CLAUDE_CODE_OAUTH_TOKEN` was not set, so live OAuth usage lookup could not run |

Latest local allowance checks:

| Provider | Window | Source | Result |
| --- | --- | --- | --- |
| Codex | Five hour | `codex_chatgpt_auth` | `live`; displays 63% remaining, with 37% used as supporting metadata; reset at `2026-06-03T13:15:20.000Z`; endpoint reported plan type `plus` |
| Codex | Weekly | `codex_chatgpt_auth` | `live`; 39% used, 61% remaining, reset at `2026-06-08T11:13:51.000Z`; endpoint reported plan type `plus` |
| Claude | Five hour | Local OAuth | `unsupported`; Claude Code is installed but no readable OAuth token or credential file exists; use manual mode |
| Claude | Weekly | Local OAuth | `unsupported`; Claude Code is installed but no readable OAuth token or credential file exists; use manual mode |

Outcome: V1 now supports live Codex allowance status through the local Codex ChatGPT auth path. Claude remains manual-first on this machine unless Claude Code OAuth credentials are configured or a future browser/app bridge is added.

## 2026-06-02

Environment:

- Workspace: `C:\Users\j7636\Documents\Playground\ulanzi-monitor-toggle`
- OS target: Windows 11
- Plugin package folder: `com.ulanzi.monitortoggle.ulanziPlugin`
- Manifest UUID: `com.ulanzi.ulanzistudio.monitortoggle`

This entry records the original Monitor Toggle prototype before the utility-suite refactor. Current package and manifest details are documented in `docs/ARCHITECTURE.md`.

Checks performed:

| Check | Command | Result |
| --- | --- | --- |
| JSON parse | `npm run validate:json` | Passed |
| Backend display list | `npm run backend:list` | Passed; returned 3 active displays |
| Node wrapper display list | `npm run node:list` | Passed; Node invoked backend and parsed JSON |
| Snapshot create | `WindowsDisplayControl.ps1 -Action snapshot` | Passed; snapshot written to `%TEMP%\ulanzi-monitor-toggle-test.bin` |
| Disable-all safety guard | `WindowsDisplayControl.ps1 -Action disable` with all active display keys | Passed; refused with `Refusing to disable every active display.` |

Detected active displays during verification:

| Friendly name | Source | Output | Key | Primary |
| --- | --- | --- | --- | --- |
| Dell AW3821DW | `\\.\DISPLAY1` | DisplayPort external | `00000000:00018080:24833` | No |
| Odyssey G93SD | `\\.\DISPLAY2` | HDMI | `00000000:00018080:24832` | Yes |
| Display 256 | `\\.\DISPLAY52` | Indirect wired | `00000001:43363BB5:256` | No |

Not yet performed:

- Actual non-primary monitor disable.
- Restore after an actual disable.
- Ulanzi Studio local plugin install.
- D200H button state verification.
