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
    Sort-Object @{ Expression = { if ($_.Name -eq "UlanziDeck.exe") { 0 } else { 1 } } }, Name
}

function Get-HelperProcessIds {
  $ids = @{}
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction SilentlyContinue

  while ($current) {
    $ids[[int]$current.ProcessId] = $true

    if (-not $current.ParentProcessId) {
      break
    }

    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
  }

  return $ids
}

function Stop-UlanziProcesses {
  param(
    [array]$Processes,
    [hashtable]$ProtectedIds
  )

  foreach ($process in $Processes) {
    if ($ProtectedIds.ContainsKey([int]$process.ProcessId)) {
      Write-RestartLog "skipping protected $($process.Name) pid=$($process.ProcessId)"
      continue
    }

    try {
      $liveProcess = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
      if (-not $liveProcess) {
        Write-RestartLog "already stopped $($process.Name) pid=$($process.ProcessId)"
        continue
      }

      Write-RestartLog "stopping $($process.Name) pid=$($process.ProcessId)"
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-RestartLog "stop requested for $($process.Name) pid=$($process.ProcessId)"
    } catch {
      Write-RestartLog "failed to stop pid=$($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

$install = Resolve-UlanziInstall
$processes = @(Get-UlanziProcesses $install.Root)
$protectedIds = Get-HelperProcessIds

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

$mainProcesses = @($processes | Where-Object { $_.Name -eq "UlanziDeck.exe" })
Stop-UlanziProcesses -Processes $mainProcesses -ProtectedIds $protectedIds

Start-Sleep -Milliseconds 750

$remainingProcesses = @(Get-UlanziProcesses $install.Root | Where-Object { $_.Name -ne "UlanziDeck.exe" })
Stop-UlanziProcesses -Processes $remainingProcesses -ProtectedIds $protectedIds

Start-Sleep -Seconds 1

Write-RestartLog "starting $($install.Executable)"
Start-Process -FilePath $install.Executable -WorkingDirectory $install.Root -WindowStyle Normal | Out-Null
Write-RestartLog "restart helper finished"
