@echo off
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "COMFYUI_DIR=%APP_DIR%..\ComfyUI"
set COMFY_PORT=8188
set SERVER_PORT=3000

echo [gen-console] Checking ComfyUI...
for /f %%C in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:%COMFY_PORT%/system_stats' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }"') do set COMFY_CODE=%%C

if "%COMFY_CODE%"=="200" (
  echo [gen-console] ComfyUI already running.
) else (
  echo [gen-console] Starting ComfyUI...
  start "gen-console-comfyui" /min "%COMFYUI_DIR%\.venv\Scripts\python.exe" "%COMFYUI_DIR%\main.py" --listen 127.0.0.1

  echo [gen-console] Waiting for ComfyUI to become healthy...
  powershell -NoProfile -Command "$ok=$false; for ($i=0; $i -lt 90; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%COMFY_PORT%/system_stats' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {}; Start-Sleep -Seconds 2 }; if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo [gen-console] ERROR: ComfyUI did not become healthy in time.
    exit /b 1
  )
  echo [gen-console] ComfyUI is healthy.
)

echo [gen-console] Checking gen-console server...
for /f %%S in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:%SERVER_PORT%/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }"') do set SERVER_CODE=%%S

if "%SERVER_CODE%"=="200" (
  echo [gen-console] Server already running.
) else (
  echo [gen-console] Starting gen-console server...
  start "gen-console-server" /min node "%APP_DIR%server\index.js"

  powershell -NoProfile -Command "$ok=$false; for ($i=0; $i -lt 30; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%SERVER_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo [gen-console] ERROR: server did not become healthy in time.
    exit /b 1
  )
  echo [gen-console] Server is healthy.
)

start http://127.0.0.1:%SERVER_PORT%/
endlocal
