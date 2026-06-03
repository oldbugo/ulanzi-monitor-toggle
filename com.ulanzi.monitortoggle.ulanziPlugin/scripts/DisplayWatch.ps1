[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Write-WatchEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Type
    )

    [pscustomobject]@{
        type = $Type
        timestamp = [DateTimeOffset]::Now.ToString("o")
    } | ConvertTo-Json -Compress

    [Console]::Out.Flush()
}

$handler = [System.EventHandler]{
    param($Sender, $EventArgs)
    Write-WatchEvent -Type "display-settings-changed"
}

try {
    [Microsoft.Win32.SystemEvents]::add_DisplaySettingsChanged($handler)
    Write-WatchEvent -Type "watcher-started"

    while ($true) {
        Start-Sleep -Seconds 3600
    }
}
finally {
    [Microsoft.Win32.SystemEvents]::remove_DisplaySettingsChanged($handler)
}
