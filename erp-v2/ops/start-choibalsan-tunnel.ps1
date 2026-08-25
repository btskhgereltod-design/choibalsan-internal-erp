[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$configPath = "C:\Users\HYDN\.cloudflared\config.yml"
$tunnelId = "86431d67-10bf-46de-92fc-d0a93034ed8e"

if (!(Test-Path -LiteralPath $cloudflaredPath)) {
    throw "cloudflared executable not found: $cloudflaredPath"
}
if (!(Test-Path -LiteralPath $configPath)) {
    throw "Choibalsan tunnel config not found: $configPath"
}

$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match [regex]::Escape($tunnelId) -or $_.CommandLine -match "choibalsan-erp" }

if (!$alreadyRunning) {
    Start-Process -FilePath $cloudflaredPath `
        -ArgumentList @("tunnel", "--config", $configPath, "run", "choibalsan-erp") `
        -WindowStyle Hidden
}

