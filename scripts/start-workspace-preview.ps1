$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
Push-Location $workspaceRoot
try {
  node scripts/verify-dev-supabase-environment.js
  if ($LASTEXITCODE -ne 0) { throw 'DEV verification failed' }
  npm --prefix vue-workspace run build
  if ($LASTEXITCODE -ne 0) { throw 'Vue build failed' }
  New-Item -ItemType Directory -Path 'public/workspace' -Force | Out-Null
  Copy-Item -Path 'vue-workspace/dist/*' -Destination 'public/workspace' -Recurse -Force
  New-Item -ItemType Directory -Path '.tmp-check' -Force | Out-Null
  if (-not (Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/workspace-backend.cjs --integrated' -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspaceRoot '.tmp-check/integrated-test.log') -RedirectStandardError (Join-Path $workspaceRoot '.tmp-check/integrated-test.err.log')
  }
  Write-Host 'Original test site: http://localhost:3002'
  Write-Host 'New full-site workspace: http://localhost:3002/workspace/index.html'
} finally { Pop-Location }
