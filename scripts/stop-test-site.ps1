$ErrorActionPreference = 'Stop'
# 只停止「佔用 3002、且命令列屬於本專案 next」的 node 程序（含本專案的 workspace-backend 父程序）。
$root = Split-Path -Parent $PSScriptRoot
$nextMarker = Join-Path $root 'node_modules\next'
$backendMarker = Join-Path $root 'scripts\workspace-backend.cjs'

function Test-ProjectNode($proc) {
  if (-not $proc -or $proc.Name -ne 'node.exe' -or -not $proc.CommandLine) { return $false }
  $cl = $proc.CommandLine
  return ($cl.IndexOf($nextMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
         ($cl.IndexOf($backendMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

$listeners = @(Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
  Write-Host '3002 沒有程序在執行，不需停止。'
  exit 0
}

$stopped = 0
# IPv4 / IPv6 可能回傳同一個 PID，先去重
$pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($ownerPid in $pids) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
  if (-not $proc) { continue }  # 程序已不存在（例如被前一圈的父程序鏈一併停掉），視為已停止
  if (-not (Test-ProjectNode $proc)) {
    Write-Host "3002 被其他程序佔用（PID $ownerPid），不屬於本專案，未停止。"
    exit 1
  }
  # 先收集本專案的父程序鏈，再由外而內停止
  $chain = @($proc)
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
  while ($parent -and (Test-ProjectNode $parent)) {
    $chain += $parent
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  [array]::Reverse($chain)
  foreach ($p in $chain) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
  }
}
Start-Sleep -Seconds 1
if (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host '3002 仍有程序在監聽，請稍後再試。'
  exit 1
}
Write-Host "已停止本專案的測試站（程序數 $stopped）。"
