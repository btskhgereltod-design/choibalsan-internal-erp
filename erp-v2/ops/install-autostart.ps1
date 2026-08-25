$ErrorActionPreference = "Stop"
$StartScript = Join-Path $PSScriptRoot "start-erp.ps1"
if (-not (Test-Path -LiteralPath $StartScript)) { throw "start-erp.ps1 олдсонгүй" }
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName "Choibalsan ERP v2 Startup" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Starts the local COP ERP Docker stack after Windows logon." -Force
Write-Host "Choibalsan ERP v2 autostart task installed."
