$ErrorActionPreference = "Stop"
$ruleName = "Choibalsan ERP v2 LAN 4100"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "PowerShell-ийг Run as administrator гэж нээгээд энэ script-ийг ажиллуулна уу."
}
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "ERP v2 LAN firewall access disabled." -ForegroundColor Yellow
