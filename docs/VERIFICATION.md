# Verification Log

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
| AI allowance unit tests | `npm run test:ai-allowance` | Passed; 8 `node:test` cases |
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

Latest local allowance checks:

| Provider | Window | Source | Result |
| --- | --- | --- | --- |
| Codex | Five hour | `codex_chatgpt_auth` | `live`; 37% used, 63% remaining, reset at `2026-06-03T13:15:20.000Z`; endpoint reported plan type `plus` |
| Codex | Weekly | `codex_chatgpt_auth` | `live`; 39% used, 61% remaining, reset at `2026-06-08T11:13:51.000Z`; endpoint reported plan type `plus` |
| Claude | Five hour | Local OAuth | `unsupported`; Claude Code is installed but no readable OAuth credential exists; use manual mode |
| Claude | Weekly | Local OAuth | `unsupported`; Claude Code is installed but no readable OAuth credential exists; use manual mode |

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
