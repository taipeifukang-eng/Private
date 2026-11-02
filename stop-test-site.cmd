@echo off
rem Stops only this project's next process on port 3002; other programs are left alone.
pushd "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-test-site.ps1"
set RC=%ERRORLEVEL%
popd
pause
exit /b %RC%
