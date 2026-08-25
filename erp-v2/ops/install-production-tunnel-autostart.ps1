[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "OVERVA Production Tunnel"
$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "cloudflared.production.yml"

if (!(Test-Path -LiteralPath $cloudflaredPath)) {
    throw "cloudflared is not installed at $cloudflaredPath"
}
if (!(Test-Path -LiteralPath $configPath)) {
    throw "Production tunnel configuration is missing at $configPath"
}

$quotedConfigPath = '"' + $configPath + '"'
$action = New-ScheduledTaskAction -Execute $cloudflaredPath -Argument "tunnel --config $quotedConfigPath run overva-production"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Starts the OVERVA production Cloudflare Tunnel after Windows logon." -Force | Out-Null
Write-Host "Scheduled task '$taskName' installed for $env:USERNAME."
