param(
  [Parameter(Mandatory)][string]$Archivo,
  [Parameter(Mandatory)][string]$Detener,
  [Parameter(Mandatory)][int]$NodePid,
  [Parameter(Mandatory)][string]$Contenedor
)
$ErrorActionPreference = 'Continue'
$previoCPU = $null
$previoTiempo = $null
$nucleos = [Environment]::ProcessorCount
$consulta = "SELECT json_build_object('conexiones', (SELECT count(*) FROM pg_stat_activity WHERE datname='viajes' AND pid <> pg_backend_pid()), 'activas', (SELECT count(*) FROM pg_stat_activity WHERE datname='viajes' AND state='active' AND pid <> pg_backend_pid()), 'esperas_lock', (SELECT count(*) FROM pg_stat_activity WHERE datname='viajes' AND wait_event_type='Lock' AND pid <> pg_backend_pid()), 'locks_pendientes', (SELECT count(*) FROM pg_locks WHERE NOT granted AND database=(SELECT oid FROM pg_database WHERE datname='viajes')), 'commits', xact_commit, 'rollbacks', xact_rollback, 'deadlocks', deadlocks, 'bloques_leidos', blks_read, 'bloques_cache', blks_hit) FROM pg_stat_database WHERE datname='viajes';"
while (-not (Test-Path -LiteralPath $Detener)) {
  $instante = Get-Date
  try {
    $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    $os = Get-CimInstance Win32_OperatingSystem
    $usoMemoria = [math]::Round(100 * ($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize, 2)
    $proceso = Get-Process -Id $NodePid -ErrorAction Stop
    $cpuNodo = $null
    if ($null -ne $previoCPU -and $previoTiempo) {
      $segundos = ($instante - $previoTiempo).TotalSeconds
      if ($segundos -gt 0) { $cpuNodo = [math]::Round(100 * ($proceso.CPU - $previoCPU) / $segundos / $nucleos, 2) }
    }
    $previoCPU = $proceso.CPU
    $previoTiempo = $instante
    $dockerTexto = docker stats --no-stream --format '{{json .}}' $Contenedor
    $docker = if ($LASTEXITCODE -eq 0 -and $dockerTexto) { $dockerTexto | ConvertFrom-Json } else { $null }
    $dbTexto = docker exec $Contenedor psql -U viajes -d postgres -A -t -c $consulta
    $db = if ($LASTEXITCODE -eq 0 -and $dbTexto) { $dbTexto | ConvertFrom-Json } else { $null }
    [ordered]@{
      hora = $instante.ToString('o')
      cpu_pc_pct = $cpu
      memoria_pc_pct = $usoMemoria
      memoria_libre_mib = [math]::Round($os.FreePhysicalMemory / 1024, 1)
      cpu_node_pct_pc = $cpuNodo
      memoria_node_mib = [math]::Round($proceso.WorkingSet64 / 1MB, 1)
      docker_cpu = if ($docker) { $docker.CPUPerc } else { $null }
      docker_memoria = if ($docker) { $docker.MemUsage } else { $null }
      postgres = $db
    } | ConvertTo-Json -Depth 4 -Compress | Add-Content -LiteralPath $Archivo -Encoding utf8
  } catch {
    [ordered]@{ hora = $instante.ToString('o'); error = $_.Exception.Message } | ConvertTo-Json -Compress | Add-Content -LiteralPath $Archivo -Encoding utf8
  }
  Start-Sleep -Seconds 2
}
