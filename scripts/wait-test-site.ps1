param([int]$TimeoutSeconds = 180)
# 等待 http://localhost:3002 就緒。/api/workspace/session 回 200 或 401 視為就緒；回 503 代表未通過 DEV 守衛。
$url = 'http://localhost:3002/api/workspace/session'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  $status = 0
  try {
    $req = [System.Net.WebRequest]::Create($url)
    $req.Timeout = 4000
    $resp = $req.GetResponse()
    $status = [int]$resp.StatusCode
    $resp.Close()
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  } catch { $status = 0 }
  if ($status -eq 503) { Write-Host '測試站回 503：未通過 DEV 守衛，不開啟。'; exit 2 }
  if ($status -gt 0 -and $status -lt 500) { exit 0 }
  Start-Sleep -Seconds 2
}
exit 1
