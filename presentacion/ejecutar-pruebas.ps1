[CmdletBinding()]
param(
  [string]$Node = '',
  [string]$K6 = '',
  [switch]$GrafanaCloud
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $raiz 'viajes-backend'
$web = Join-Path $raiz 'viajes-web'
$e2e = Join-Path $raiz 'e2e'
if (-not $Node) {
  $candidato = Join-Path $env:USERPROFILE '.nvm\versions\node\v22.23.5\bin\node.exe'
  if (Test-Path -LiteralPath $candidato) { $Node = $candidato } else { $Node = (Get-Command node -ErrorAction Stop).Source }
}
if (-not (& $Node --version).StartsWith('v22.')) { throw 'Se necesita Node 22. Usá -Node con la ruta a node.exe de esa versión.' }
if (-not $K6) {
  $comandoK6 = Get-Command k6 -ErrorAction SilentlyContinue
  if ($comandoK6) { $K6 = $comandoK6.Source } else { $K6 = 'C:\Program Files\k6\k6.exe' }
}
if (-not (Test-Path -LiteralPath $K6)) { throw 'No encontré k6. Instalalo o indicá su ruta con -K6.' }
foreach ($archivo in @((Join-Path $backend 'node_modules\dotenv\package.json'), (Join-Path $web 'node_modules\vite\bin\vite.js'), (Join-Path $e2e 'node_modules\@playwright\test\cli.js'))) {
  if (-not (Test-Path -LiteralPath $archivo)) { throw "Falta una dependencia: $archivo. Consultá la guía de instalación." }
}
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop no está disponible.' }
foreach ($puerto in 5544, 3101, 5174) {
  if (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) { throw "El puerto $puerto está ocupado. Liberalo antes de empezar." }
}
$marca = Get-Date -Format 'yyyyMMdd-HHmmss'
$salida = Join-Path $raiz "resultados-presentacion\$marca"
New-Item -ItemType Directory -Path $salida -Force | Out-Null
$contenedor = "viajes-presentacion-$marca"
$apiProceso = $null
$webProceso = $null
$estados = [ordered]@{ commit = (& git -C $raiz rev-parse HEAD); fecha = (Get-Date -Format o); node = (& $Node --version); k6 = (& $K6 version); backend = 'no ejecutado'; e2e = 'no ejecutado'; carga = 'no ejecutado'; grafana = if ($GrafanaCloud) { 'solicitado' } else { 'no solicitado' } }
function Ejecutar-Node([string]$Directorio, [string[]]$Argumentos, [string]$Archivo) {
  Push-Location $Directorio
  try {
    & $Node @Argumentos *> $Archivo
    return $LASTEXITCODE
  } finally { Pop-Location }
}
function Esperar-HTTP([string]$url) {
  for ($i = 0; $i -lt 60; $i++) {
    & curl.exe --silent --fail --max-time 5 $url *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  throw "No respondió $url; revisar los logs en $salida"
}
try {
  Write-Host "Resultados: $salida"
  docker run -d --name $contenedor -e POSTGRES_USER=viajes -e POSTGRES_PASSWORD=viajes -e POSTGRES_DB=postgres -p 127.0.0.1:5544:5432 postgis/postgis:16-3.4-alpine *> (Join-Path $salida 'docker.txt')
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL de prueba.' }
  $disponible = $false
  for ($i = 0; $i -lt 60; $i++) {
    # El servidor temporal de inicialización solo abre socket local; esperar TCP real.
    docker exec $contenedor pg_isready -h 127.0.0.1 -U viajes -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $disponible = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $disponible) { throw 'PostgreSQL de prueba no llegó a estar listo.' }
  $env:DATABASE_URL = 'postgres://viajes_app:viajes_app_dev@localhost:5544/viajes'
  $env:BILLETERA_DATABASE_URL = 'postgres://billetera_app:billetera_app_dev@localhost:5544/billetera'
  $env:LECTURA_DATABASE_URL = 'postgres://lectura_app:lectura_app_dev@localhost:5544/lectura'
  $env:ADMIN_DATABASE_URL = 'postgres://viajes:viajes@localhost:5544/postgres'
  $env:DATABASE_SSL = 'false'
  $env:JWT_SECRET = 'secreto-local-de-presentacion-de-al-menos-32-caracteres'
  $env:JWT_ACCESS_TOKEN_TTL = '15m'
  $env:WEBHOOK_HMAC_SECRET = 'secreto-webhook-presentacion-de-al-menos-32-caracteres'
  $env:E2E_WEBHOOK_SECRET = $env:WEBHOOK_HMAC_SECRET
  $env:ARGON2_MEMORY_COST = '19456'
  $env:ARGON2_TIME_COST = '2'
  $env:ARGON2_PARALLELISM = '1'
  $env:PORT = '3101'
  $env:CORS_ORIGINS = 'http://localhost:5174'
  $env:RATE_LIMIT_LOGIN_MAX = '100'
  if ((Ejecutar-Node $backend @('src/infra/db/migrate.js') (Join-Path $salida 'migraciones-app.txt')) -ne 0) { throw 'Fallaron las migraciones del backend.' }
  if ((Ejecutar-Node $backend @('src/infra/db/seed.js') (Join-Path $salida 'seed.txt')) -ne 0) { throw 'Falló la preparación de datos de prueba.' }
  if ((Ejecutar-Node $backend @('src/infra/db/migrate.js','--pruebas') (Join-Path $salida 'migraciones-tests.txt')) -ne 0) { throw 'Fallaron las migraciones de las bases de tests.' }
  Write-Host 'Ejecutando tests de backend (dominio, integración y seguridad)...'
  $urlApp = $env:DATABASE_URL
  $env:DATABASE_URL = 'postgres://viajes:viajes@localhost:5544/viajes_test'
  $codigoBackend = Ejecutar-Node $backend @('--test','--test-concurrency=1','--test-reporter=tap') (Join-Path $salida 'backend-tap.txt')
  $estados.backend = if ($codigoBackend -eq 0) { 'aprobado' } else { "fallo (código $codigoBackend)" }
  $env:DATABASE_URL = $urlApp
  Write-Host 'Iniciando backend y web aislados...'
  $apiProceso = Start-Process -FilePath $Node -ArgumentList '../observabilidad/capturar-logs.mjs','--iniciar-backend' -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $salida 'backend-servidor.txt') -RedirectStandardError (Join-Path $salida 'backend-errores.txt') -PassThru
  $env:VITE_MAPA = 'simulado'
  $env:VITE_API_URL = 'http://localhost:3101'
  $webProceso = Start-Process -FilePath $Node -ArgumentList 'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort' -WorkingDirectory $web -WindowStyle Hidden -RedirectStandardOutput (Join-Path $salida 'web-servidor.txt') -RedirectStandardError (Join-Path $salida 'web-errores.txt') -PassThru
  Esperar-HTTP 'http://127.0.0.1:3101/ready'
  Write-Host 'Backend listo.'
  Esperar-HTTP 'http://127.0.0.1:5174/'
  Write-Host 'Web lista.'
  $env:API_URL = 'http://localhost:3101'
  $env:WEB_URL = 'http://localhost:5174'
  $env:E2E_ENTORNO_DESCARTABLE = '1'
  $env:PLAYWRIGHT_HTML_OUTPUT_DIR = Join-Path $salida 'reporte-playwright'
  Write-Host 'Ejecutando Playwright (incluye espera de vencimiento)...'
  $codigoE2E = Ejecutar-Node $e2e @('node_modules/@playwright/test/cli.js','test','--reporter=list,html') (Join-Path $salida 'playwright.txt')
  $estados.e2e = if ($codigoE2E -eq 0) { 'aprobado' } else { "fallo (código $codigoE2E)" }
  Write-Host 'Ejecutando k6: 2 usuarios virtuales durante 30 segundos...'
  $email = "presentacion-$([guid]::NewGuid().ToString('N'))@demo.local"
  $registro = @{ email = $email; password = 'ClavePrueba123!'; rol = 'pasajero' } | ConvertTo-Json
  $sesion = Invoke-RestMethod -Method Post -Uri 'http://localhost:3101/auth/register' -ContentType 'application/json' -Body $registro
  if (-not $sesion.accessToken) { throw 'No se obtuvo el token del pasajero de prueba.' }
  $env:TOKEN_PASAJERO = $sesion.accessToken
  $archivoK6 = Join-Path $salida 'k6-resumen.json'
  Push-Location $raiz
  try {
    if ($GrafanaCloud) {
      & $K6 cloud run --local-execution --no-archive-upload --no-cloud-logs -e "TOKEN_PASAJERO=$env:TOKEN_PASAJERO" -e BASE_URL=http://localhost:3101 -e VUS=2 -e DURATION=30s --summary-export=$archivoK6 carga/viajes.js *> (Join-Path $salida 'k6.txt')
    } else {
      & $K6 run -e BASE_URL=http://localhost:3101 -e VUS=2 -e DURATION=30s --summary-export=$archivoK6 carga/viajes.js *> (Join-Path $salida 'k6.txt')
    }
    $codigoK6 = $LASTEXITCODE
  } finally { Pop-Location; Remove-Item Env:TOKEN_PASAJERO -ErrorAction SilentlyContinue }
  $estados.carga = if ($codigoK6 -eq 0) { 'aprobado' } else { "fallo (código $codigoK6)" }
  if ($GrafanaCloud) { $estados.grafana = if ($codigoK6 -eq 0) { 'verificar enlace en k6.txt' } else { 'falló o requiere revisión: ver k6.txt' } }
} catch {
  $estados.error = $_.Exception.Message
  Write-Error $_ -ErrorAction Continue
} finally {
  $estados | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $salida 'estado.json') -Encoding utf8
  $lineasInforme = @(
    '# Resumen de pruebas',
    '',
    "- Fecha: $($estados.fecha)",
    "- Commit: $($estados.commit)",
    "- Node: $($estados.node)",
    "- k6: $($estados.k6)",
    "- Backend: $($estados.backend)",
    "- Playwright: $($estados.e2e)",
    "- Carga de 2 VUs durante 30 s: $($estados.carga)",
    '',
    '## Backend',
    '',
    'El archivo backend-tap.txt contiene el detalle de pruebas unitarias, integración y seguridad.'
  )
  $tap = Join-Path $salida 'backend-tap.txt'
  if (Test-Path -LiteralPath $tap) {
    $lineasInforme += '~~~text'
    $lineasInforme += @(Get-Content -LiteralPath $tap | Select-String -Pattern '^# (tests|pass|fail|skipped|duration_ms) ' | ForEach-Object { $_.Line })
    $lineasInforme += '~~~'
  }
  $lineasInforme += @('', '## Playwright', '', '[Abrir reporte HTML](reporte-playwright/index.html). El detalle de la ejecución está en playwright.txt.', '', '## k6', '')
  $resumenK6 = Join-Path $salida 'k6-resumen.json'
  if (Test-Path -LiteralPath $resumenK6) {
    try {
      $metricas = (Get-Content -LiteralPath $resumenK6 -Raw | ConvertFrom-Json).metrics
      $duracion = $metricas.http_req_duration
      $lineasInforme += "- Solicitudes: $($metricas.http_reqs.count)"
      $lineasInforme += "- Checks exitosos / fallidos: $($metricas.checks.passes) / $($metricas.checks.fails)"
      $lineasInforme += "- Fracción de errores HTTP: $($metricas.http_req_failed.value)"
      $lineasInforme += "- Tiempo medio: $([math]::Round($duracion.avg, 2)) ms"
      $lineasInforme += "- p95: $([math]::Round($duracion.'p(95)', 2)) ms"
      $lineasInforme += "- p99: $([math]::Round($duracion.'p(99)', 2)) ms"
      $lineasInforme += "- Máximo: $([math]::Round($duracion.max, 2)) ms"
    } catch { $lineasInforme += 'No se pudo interpretar el JSON de k6; revisar k6.txt.' }
  } else { $lineasInforme += 'No se generó resumen de k6; revisar k6.txt.' }
  $logK6 = Join-Path $salida 'k6.txt'
  if (Test-Path -LiteralPath $logK6) {
    $textoK6 = Get-Content -LiteralPath $logK6 -Raw
    if ($textoK6 -match 'https://[^\s)]+/a/k6-app/runs/[0-9]+') { $lineasInforme += "- Grafana: $($Matches[0])" }
  }
  $lineasInforme += @('', 'El p95 es el tiempo bajo el cual se encuentra aproximadamente el 95 % de las respuestas. La carga baja local no determina la capacidad máxima. Comprobar los gráficos y logs de Grafana antes de presentarlos.')
  $lineasInforme | Set-Content -LiteralPath (Join-Path $salida 'RESUMEN.md') -Encoding utf8
  if ($webProceso -and -not $webProceso.HasExited) { Stop-Process -Id $webProceso.Id -ErrorAction SilentlyContinue }
  if ($apiProceso -and -not $apiProceso.HasExited) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($apiProceso.Id)" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $apiProceso.Id -ErrorAction SilentlyContinue
  }
  docker stop $contenedor *> $null
}
Write-Host "Resultado: backend=$($estados.backend); E2E=$($estados.e2e); carga=$($estados.carga). Archivos: $salida"
if ($estados.error -or $estados.backend -ne 'aprobado' -or $estados.e2e -ne 'aprobado' -or $estados.carga -ne 'aprobado') { exit 1 }
