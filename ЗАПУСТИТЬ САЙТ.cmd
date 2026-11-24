@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node local-start.js
) else (
  "%USERPROFILE%\nodejs\node.exe" local-start.js
)
echo.
pause
