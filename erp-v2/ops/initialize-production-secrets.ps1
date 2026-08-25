[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretDirectory = Join-Path $projectRoot "secrets"
$environmentFile = Join-Path $projectRoot ".env.production"
$environmentExample = Join-Path $projectRoot ".env.production.example"

$secretFiles = @(
    "postgres_password",
    "app_database_password",
    "migration_database_url",
    "app_database_url",
    "jwt_secret"
)

if (Test-Path -LiteralPath $environmentFile) {
    throw ".env.production already exists; refusing to overwrite production configuration."
}

foreach ($name in $secretFiles) {
    $target = Join-Path $secretDirectory $name
    if (Test-Path -LiteralPath $target) {
        throw "$name already exists; refusing to overwrite production secrets."
    }
}

function New-CryptographicSecret([int]$byteCount) {
    $bytes = [byte[]]::new($byteCount)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
}

New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
$adminPassword = New-CryptographicSecret 48
$appPassword = New-CryptographicSecret 48
$jwtSecret = New-CryptographicSecret 64
$adminPasswordEncoded = [Uri]::EscapeDataString($adminPassword)
$appPasswordEncoded = [Uri]::EscapeDataString($appPassword)

Set-Content -LiteralPath (Join-Path $secretDirectory "postgres_password") -Value $adminPassword -NoNewline -Encoding utf8
Set-Content -LiteralPath (Join-Path $secretDirectory "app_database_password") -Value $appPassword -NoNewline -Encoding utf8
Set-Content -LiteralPath (Join-Path $secretDirectory "jwt_secret") -Value $jwtSecret -NoNewline -Encoding utf8
Set-Content -LiteralPath (Join-Path $secretDirectory "migration_database_url") -Value "postgresql://overva:${adminPasswordEncoded}@db:5432/overva" -NoNewline -Encoding utf8
Set-Content -LiteralPath (Join-Path $secretDirectory "app_database_url") -Value "postgresql://overva_app:${appPasswordEncoded}@db:5432/overva" -NoNewline -Encoding utf8
Copy-Item -LiteralPath $environmentExample -Destination $environmentFile

Write-Host "Production environment and five secret files created. Secret values were not printed."
