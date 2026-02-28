git add -A 2>&1 | Tee-Object -FilePath push_log.txt
git commit -m "fix: allow searching resigned employees in bonus modules" 2>&1 | Tee-Object -FilePath push_log.txt -Append
git push 2>&1 | Tee-Object -FilePath push_log.txt -Append
Write-Output "=== DONE ===" | Tee-Object -FilePath push_log.txt -Append
