@echo off
REM ============================================================================
REM  Bookynotes - start everything.
REM
REM  Brings up both halves of the app in their own windows:
REM
REM    page-processor   FastAPI + OpenCV, flattens page photographs   :8000
REM    web              Next.js                                       :3000
REM
REM  The page-processor is optional by design. If its virtualenv or its secret
REM  is missing, this script says so and starts the web app anyway - uploads are
REM  then stored exactly as they arrive, which is how the deployed instance
REM  runs. See page-processor/README.md.
REM
REM  Close either window, or press Ctrl+C in it, to stop that half.
REM ============================================================================

setlocal EnableDelayedExpansion

REM Work from the script's own folder, so double-clicking it works the same as
REM running it from a prompt somewhere else.
cd /d "%~dp0"

echo.
echo   Bookynotes
echo   ----------
echo.

REM ---------------------------------------------------------------------------
REM  Prerequisites
REM ---------------------------------------------------------------------------

where node >nul 2>&1
if errorlevel 1 (
    echo   [x] Node is not on your PATH. Install Node 22 or later.
    goto :fail
)

if not exist ".env.local" (
    echo   [x] .env.local is missing.
    echo       Copy .env.example to .env.local and fill it in - the app refuses
    echo       to build without it, deliberately.
    goto :fail
)

if not exist "node_modules" (
    echo   [ ] node_modules missing, installing...
    call npm install
    if errorlevel 1 goto :fail
    echo   [+] dependencies installed
)

REM ---------------------------------------------------------------------------
REM  Clear stale app servers before starting fresh.
REM
REM  A stale server serving an old build is a genuinely confusing failure - the
REM  code changes and the browser does not. This script owns the app's dev
REM  ports, so it frees them every time before launching new windows.
REM ---------------------------------------------------------------------------

call :stop_port 3000 "web"
call :stop_port 8000 "page-processor"

REM ---------------------------------------------------------------------------
REM  The page-processor's secret, read from .env.local so there is one copy of
REM  it rather than two that can drift apart.
REM ---------------------------------------------------------------------------

set "PAGE_SECRET="
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /c:"PAGE_PROCESSOR_SECRET=" ".env.local"`) do (
    set "PAGE_SECRET=%%b"
)

set "PYTHON=page-processor\.venv\Scripts\python.exe"

if not defined PAGE_SECRET (
    echo   [!] PAGE_PROCESSOR_SECRET is not set in .env.local.
    echo       Starting without the page-processor. Uploads will be stored
    echo       exactly as they arrive.
    goto :start_web
)

if not exist "%PYTHON%" (
    echo   [!] page-processor has no virtualenv yet.
    echo       Creating one - this takes a minute the first time.
    python -m venv page-processor\.venv
    if errorlevel 1 (
        echo   [!] Could not create it. Is Python 3.11+ installed?
        echo       Starting without the page-processor.
        goto :start_web
    )
    "%PYTHON%" -m pip install --quiet --upgrade pip
    "%PYTHON%" -m pip install --quiet -r page-processor\requirements.txt
    if errorlevel 1 (
        echo   [!] Dependency install failed. Starting without the page-processor.
        goto :start_web
    )
    echo   [+] virtualenv ready
)

echo   [^>] page-processor  http://127.0.0.1:8000
REM  --app-dir puts page-processor on Python's path, so this needs no "cd" and
REM  therefore no quotes inside quotes - which batch handles badly.
start "Bookynotes page-processor" cmd /k "set PAGE_PROCESSOR_SECRET=%PAGE_SECRET%&& page-processor\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir page-processor --host 127.0.0.1 --port 8000"

REM Give uvicorn a moment to bind, so the first upload does not race it.
REM
REM  "ping" rather than "timeout": timeout reads the keyboard, so it aborts with
REM  "Input redirection is not supported" the moment this script is piped to a
REM  log or run from another tool. ping just waits.
call :wait 3

:start_web
echo   [^>] web             http://localhost:3000
echo.
echo   Both run in their own windows. Ctrl+C in a window stops that half.
echo.
REM  start inherits this window's directory, which is already the repo root.
start "Bookynotes web" cmd /k "npm run dev"

REM Wait for Next to compile before opening a browser at a page that is not
REM there yet.
call :wait 8
start "" "http://localhost:3000"

endlocal
exit /b 0

REM ---------------------------------------------------------------------------
REM  Helpers
REM ---------------------------------------------------------------------------

:wait
REM  ping rather than timeout: timeout reads the keyboard, so it aborts with
REM  "Input redirection is not supported" the moment this script is piped to a
REM  log or launched by another tool. ping just waits.
ping -n %~1 127.0.0.1 >nul 2>&1
exit /b 0

:stop_port
set "FOUND_PORT="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:":%~1 "') do (
    set "FOUND_PORT=1"
    echo   [^>] stopping existing %~2 server on port %~1 ^(PID %%p^)
    taskkill /PID %%p /T /F >nul 2>&1
)
if defined FOUND_PORT (
    call :wait 2
)
exit /b 0

:fail
echo.
echo   Startup aborted.
echo.
endlocal
pause
exit /b 1
