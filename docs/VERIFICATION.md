# Verification Log

## 2026-06-02

Environment:

- Workspace: `C:\Users\j7636\Documents\Playground\ulanzi-monitor-toggle`
- OS target: Windows 11
- Plugin package folder: `com.ulanzi.monitortoggle.ulanziPlugin`
- Manifest UUID: `com.ulanzi.ulanzistudio.monitortoggle`

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
