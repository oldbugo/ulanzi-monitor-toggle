param(
  [int]$DelaySeconds = 1,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-UlanziInstall {
  $running = Get-CimInstance Win32_Process -Filter "Name = 'UlanziDeck.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath } |
    Select-Object -First 1

  if ($running -and $running.ExecutablePath) {
    return @{
      Executable = $running.ExecutablePath
      Root = Split-Path -Parent $running.ExecutablePath
    }
  }

  $candidates = @(
    "${env:ProgramFiles(x86)}\Ulanzi Studio\UlanziDeck.exe",
    "${env:ProgramFiles}\Ulanzi Studio\UlanziDeck.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) {
    return @{
      Executable = $candidates[0]
      Root = Split-Path -Parent $candidates[0]
    }
  }

  throw "UlanziDeck.exe was not found."
}

function Get-UlanziProcesses($installRoot) {
  $targetNames = @(
    "UlanziDeck.exe",
    "QtWebEngineProcess.exe",
    "crashpad_handler.exe",
    "node.exe"
  )

  $normalizedRoot = [System.IO.Path]::GetFullPath($installRoot).TrimEnd('\')

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $targetNames -contains $_.Name -and
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)
    } |
    Sort-Object @{ Expression = { if ($_.Name -eq "UlanziDeck.exe") { 1 } else { 0 } } }, Name
}

$install = Resolve-UlanziInstall
$processes = @(Get-UlanziProcesses $install.Root)

if ($DryRun) {
  [pscustomobject]@{
    executable = $install.Executable
    installRoot = $install.Root
    processCount = $processes.Count
    processes = @($processes | ForEach-Object {
      [pscustomobject]@{
        id = $_.ProcessId
        name = $_.Name
        path = $_.ExecutablePath
      }
    })
  } | ConvertTo-Json -Depth 5
  exit 0
}

Start-Sleep -Seconds ([Math]::Max(0, $DelaySeconds))

foreach ($process in $processes) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
  }
}

Start-Sleep -Seconds 1

Start-Process -FilePath $install.Executable -WorkingDirectory $install.Root -WindowStyle Normal | Out-Null
