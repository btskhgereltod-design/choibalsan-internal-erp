[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$erpRoot = Split-Path -Parent $PSScriptRoot
$publicRoot = Join-Path $erpRoot "public-site"
$containerName = "overva-market-local"
$imageName = "overva-market-local:catalog-v1"
$previewUrl = "http://localhost:4174"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required and docker.exe was not found."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop is not running or this Windows account cannot access it."
}

$existingContainer = docker container ls --all --filter "name=^/$containerName$" --format "{{.Names}}"
if ($existingContainer) {
  throw "Container '$containerName' already exists. This safe script will not replace or delete it."
}

Write-Host "Building the local OVERVA Market preview image..."
docker build `
  --file (Join-Path $publicRoot "Dockerfile") `
  --build-arg "NGINX_CONFIG=nginx.local.conf" `
  --tag $imageName `
  $publicRoot
if ($LASTEXITCODE -ne 0) {
  throw "Local Market image build failed."
}

Write-Host "Starting the local OVERVA Market preview..."
docker run `
  --detach `
  --name $containerName `
  --publish "127.0.0.1:4174:8080" `
  --add-host "host.docker.internal:host-gateway" `
  $imageName | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Local Market preview container failed to start."
}

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$previewUrl/healthz" -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $healthy) {
  throw "Container started, but the local Market health check did not pass."
}

Write-Host "OVERVA Market local preview is ready: $previewUrl"
Write-Host "This container has no Docker volume and does not use production configuration."
