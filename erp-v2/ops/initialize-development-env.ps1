[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot ".env"
}
$targetPath = [System.IO.Path]::GetFullPath($OutputPath)

if (Test-Path -LiteralPath $targetPath) {
  throw "Refusing to overwrite existing environment file: $targetPath"
}

$targetDirectory = Split-Path -Parent $targetPath
if (-not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
  throw "Output directory does not exist: $targetDirectory"
}

function New-HexSecret {
  param([ValidateRange(16, 128)][int]$ByteCount)

  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
}

$databasePassword = New-HexSecret -ByteCount 24
$jwtSecret = New-HexSecret -ByteCount 32
$tenantAdminPassword = New-HexSecret -ByteCount 18
$platformAdminPassword = New-HexSecret -ByteCount 18

$content = @"
# Generated for this computer by ops/initialize-development-env.ps1.
# Local development only. This file is ignored by Git. Never reuse these values in production.
POSTGRES_DB=erp_v2
POSTGRES_USER=erp_v2
POSTGRES_PASSWORD=$databasePassword
DATABASE_URL=postgresql://erp_v2:$databasePassword@db:5432/erp_v2
JWT_SECRET=$jwtSecret
JWT_ISSUER=overva-development
JWT_AUDIENCE=overva-development-web
CORS_ORIGINS=http://localhost:4100
ERP_WEB_BIND_IP=127.0.0.1
API_PORT=4100
BACKUP_INTERVAL_SECONDS=86400
MONITOR_INTERVAL_SECONDS=60
WEBHOOK_WORKER_INTERVAL_MS=30000

# Optional integrations stay fail-closed for an ordinary local checkout.
AI_ENABLED=false
OPENAI_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=medium
CONNECTOR_CALLBACK_BASE_URL=http://localhost:4100
CONNECTOR_APP_URL=http://localhost:4100
MARKET_APP_URL=http://localhost:4100
MARKET_EMAIL_ENABLED=false
MARKET_GOOGLE_OIDC_ENABLED=false
MARKET_SMS_ENABLED=false

# Local-only bootstrap identities. Their passwords are unique to this computer.
BOOTSTRAP_ORG_NAME=Local OVERVA Organization
BOOTSTRAP_ORG_SLUG=local-overva
BOOTSTRAP_ADMIN_NAME=Local Tenant Administrator
BOOTSTRAP_ADMIN_EMAIL=admin@local.overva
BOOTSTRAP_ADMIN_PASSWORD=$tenantAdminPassword
BOOTSTRAP_PLATFORM_ADMIN_NAME=Local Platform Administrator
BOOTSTRAP_PLATFORM_ADMIN_EMAIL=platform@local.overva
BOOTSTRAP_PLATFORM_ADMIN_PASSWORD=$platformAdminPassword
"@

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetPath, ($content.TrimStart() + [Environment]::NewLine), $utf8WithoutBom)

Write-Host "Created a local-only environment file at $targetPath"
Write-Host "Generated secret values were not printed. The file is ignored by Git."
Write-Host "Local tenant login: organization local-overva, email admin@local.overva"
Write-Host "Local platform login: platform@local.overva"
Write-Host "Copy each password directly from the local .env file when signing in; do not paste it into chat."
