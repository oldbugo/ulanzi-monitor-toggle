# Ulanzi Monitor Toggle

Prototype Ulanzi D200H plugin for toggling Windows display topology.

This project targets Windows 11 and uses a source-visible PowerShell/.NET backend instead of a bundled native executable. The backend calls documented Windows DisplayConfig APIs to list, snapshot, disable, restore, and toggle display paths.

## Local Backend Test

From the workspace folder:

```powershell
npm run install:plugin
npm run validate:json
npm run backend:list
npm run node:list
```

From the plugin package folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\DisplayCtl.ps1 -Action list
```

The command is non-destructive and should return JSON describing active displays.

## Current Status

This is an early scaffold. Start with `PLAN.md`, then verify the non-destructive backend `list` command before testing `snapshot`, `disable`, `restore`, or `toggle`.

Do not test `disable` or `toggle` against a primary or only active monitor first. The helper has a guard against disabling all active displays, but the first real topology test should target a non-primary monitor.
