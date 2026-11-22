@echo off
setlocal
rem One-click test site: env check -> build Vue -> sync -> start 3002 (integrated) -> open browser. DEV only.
pushd "%~dp0"

echo [1/3] Preparing and starting the test site (DEV only)...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-workspace-preview.ps1"
if errorlevel 1 goto :fail_start

echo [2/3] Waiting for the test site to be ready (up to about 3 minutes)...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\wait-test-site.ps1" -TimeoutSeconds 180
if errorlevel 1 goto :fail_wait

echo [3/3] Opening http://localhost:3002/workspace/index.html
start "" "http://localhost:3002/workspace/index.html"
echo Done. Double-click stop-test-site.cmd to stop.
popd
endlocal
exit /b 0

:fail_start
echo.
echo Start failed. See messages above. If the environment check failed, do not continue.
popd
pause
exit /b 1

:fail_wait
echo.
echo Test site did not become ready; browser not opened. See .tmp-check\integrated-test.err.log
popd
pause
exit /b 1
