param(
  [int]$DelaySeconds = 1,
  [string]$LogPath = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-RestartLog {
  param([string]$Message)

  if (-not $LogPath) {
    return
  }

  try {
    $directory = Split-Path -Parent $LogPath
    if ($directory) {
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    Add-Content -LiteralPath $LogPath -Value "$((Get-Date).ToString('o')) $Message"
  } catch {
  }
}

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

Write-RestartLog "helper started; executable=$($install.Executable); processCount=$($processes.Count); dryRun=$($DryRun.IsPresent)"

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
    Write-RestartLog "stopping $($process.Name) pid=$($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
    Write-RestartLog "failed to stop pid=$($process.ProcessId): $($_.Exception.Message)"
  }
}

Start-Sleep -Seconds 1

Write-RestartLog "starting $($install.Executable)"
Start-Process -FilePath $install.Executable -WorkingDirectory $install.Root -WindowStyle Normal | Out-Null
Write-RestartLog "restart helper finished"
