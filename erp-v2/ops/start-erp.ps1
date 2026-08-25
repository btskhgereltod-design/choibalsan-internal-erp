$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if (-not (Test-Path -LiteralPath $Docker)) { throw "Docker Desktop олдсонгүй: $Docker" }
Set-Location -LiteralPath $ProjectDir
& $Docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw "ERP v2 stack ассангүй" }
