$ErrorActionPreference = "Stop"
$ruleName = "Choibalsan ERP v2 LAN 4100"
$lanAddress = "192.168.100.91"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "PowerShell-ийг Run as administrator гэж нээгээд энэ script-ийг ажиллуулна уу."
}
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) { Remove-NetFirewallRule -DisplayName $ruleName }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
  -Protocol TCP -LocalAddress $lanAddress -LocalPort 4100 -RemoteAddress LocalSubnet -Profile Any | Out-Null
Write-Host "ERP v2 LAN access enabled: http://${lanAddress}:4100" -ForegroundColor Green
Write-Host "Scope: TCP 4100, LocalSubnet only. Router port forwarding is not enabled."
