[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Write-WatchEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Type,

        [string]$Source = "",

        [string]$Detail = ""
    )

    $payload = [ordered]@{
        type = $Type
        timestamp = [DateTimeOffset]::Now.ToString("o")
    }

    if ($Source) {
        $payload.source = $Source
    }

    if ($Detail) {
        $payload.detail = $Detail
    }

    [pscustomobject]$payload | ConvertTo-Json -Compress

    [Console]::Out.Flush()
}

$systemEventsRegistered = $false
$registeredSourceIds = @()

function Register-WmiWatch {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceIdentifier,

        [Parameter(Mandatory = $true)]
        [string]$Query
    )

    try {
        Register-WmiEvent -Query $Query -SourceIdentifier $SourceIdentifier | Out-Null
        $script:registeredSourceIds += $SourceIdentifier
    }
    catch {
        Write-WatchEvent -Type "watcher-registration-failed" -Source $SourceIdentifier -Detail $_.Exception.Message
    }
}

function Get-WmiEventDetail {
    param(
        [object]$EventArgs
    )

    if ($null -eq $EventArgs -or $null -eq $EventArgs.NewEvent) {
        return ""
    }

    $newEvent = $EventArgs.NewEvent
    $target = $newEvent.TargetInstance

    if ($target) {
        $fields = @()
        foreach ($name in @("Name", "DeviceID", "PNPClass", "Status")) {
            try {
                $value = $target.$name
                if ($value) {
                    $fields += "$name=$value"
                }
            }
            catch {
            }
        }

        return ($fields -join "; ")
    }

    try {
        if ($newEvent.EventType) {
            return "EventType=$($newEvent.EventType)"
        }
    }
    catch {
    }

    return ""
}

$handler = [System.EventHandler]{
    param($Sender, $EventArgs)
    Write-WatchEvent -Type "display-settings-changed" -Source "SystemEvents.DisplaySettingsChanged"
}

try {
    [Microsoft.Win32.SystemEvents]::add_DisplaySettingsChanged($handler)
    $systemEventsRegistered = $true

    Register-WmiWatch -SourceIdentifier "MonitorToggleDeviceChange" -Query "SELECT * FROM Win32_DeviceChangeEvent"
    Register-WmiWatch -SourceIdentifier "MonitorToggleDisplayConfiguration" -Query "SELECT * FROM __InstanceOperationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_DisplayConfiguration'"
    Register-WmiWatch -SourceIdentifier "MonitorToggleDesktopMonitor" -Query "SELECT * FROM __InstanceOperationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_DesktopMonitor'"
    Register-WmiWatch -SourceIdentifier "MonitorTogglePnPEntity" -Query "SELECT * FROM __InstanceOperationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_PnPEntity' AND (TargetInstance.PNPClass = 'Monitor' OR TargetInstance.PNPClass = 'Display' OR TargetInstance.DeviceID LIKE 'DISPLAY%' OR TargetInstance.DeviceID LIKE '%DISPLAY%' OR TargetInstance.Name LIKE '%Display%' OR TargetInstance.Name LIKE '%Monitor%')"

    Write-WatchEvent -Type "watcher-started"

    while ($true) {
        $event = Wait-Event -Timeout 3600
        if ($null -eq $event) {
            continue
        }

        try {
            $detail = Get-WmiEventDetail -EventArgs $event.SourceEventArgs
            Write-WatchEvent -Type "display-device-changed" -Source $event.SourceIdentifier -Detail $detail
        }
        finally {
            Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
        }
    }
}
finally {
    if ($systemEventsRegistered) {
        [Microsoft.Win32.SystemEvents]::remove_DisplaySettingsChanged($handler)
    }

    foreach ($sourceId in $registeredSourceIds) {
        Unregister-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue
        Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
    }
}
