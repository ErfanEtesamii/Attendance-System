@echo off
REM ============================================================================
REM Installs the Attendance System as a Windows Service using NSSM.
REM Run from an elevated (Administrator) prompt. Safe to re-run: an existing
REM service is stopped and re-configured, not duplicated.
REM Does NOT start the service - test manually first with: npm start
REM ============================================================================
setlocal EnableExtensions

set "SERVICE_NAME=FarazHonarAttendance"
set "DISPLAY_NAME=Faraz Honar Attendance System"
set "DESCRIPTION=Faraz Honar attendance system: Express API + admin panel + Telegram bot (src\index.js)."

REM Project root = parent of this deploy folder
pushd "%~dp0.."
set "PROJECT_DIR=%CD%"
popd

set "NSSM=%PROJECT_DIR%\deploy\nssm.exe"
set "ENTRY=%PROJECT_DIR%\src\index.js"
set "LOG_DIR=%PROJECT_DIR%\logs"

REM --- Preflight checks --------------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Run this script as Administrator.
    exit /b 1
)
if not exist "%NSSM%" (
    echo [ERROR] nssm.exe not found at "%NSSM%". Copy the win64 nssm.exe into the deploy folder.
    exit /b 1
)
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
    echo [ERROR] node.exe not found in PATH. Install Node.js first.
    exit /b 1
)
if not exist "%ENTRY%" (
    echo [ERROR] "%ENTRY%" not found.
    exit /b 1
)
if not exist "%PROJECT_DIR%\node_modules" (
    echo [ERROR] node_modules is missing. Run: npm install
    exit /b 1
)
if not exist "%PROJECT_DIR%\.env" (
    echo [ERROR] "%PROJECT_DIR%\.env" not found. Copy .env.example to .env and fill it in.
    exit /b 1
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM --- Install (or re-configure) ----------------------------------------------
sc query "%SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
    echo Installing service %SERVICE_NAME% ...
    "%NSSM%" install "%SERVICE_NAME%" "%NODE%" "%ENTRY%"
    if errorlevel 1 (
        echo [ERROR] nssm install failed.
        exit /b 1
    )
) else (
    echo Service %SERVICE_NAME% already exists - stopping and re-configuring it ...
    "%NSSM%" stop "%SERVICE_NAME%" >nul 2>&1
    "%NSSM%" set "%SERVICE_NAME%" Application "%NODE%"
    "%NSSM%" set "%SERVICE_NAME%" AppParameters "\"%ENTRY%\""
)

REM Always set AppParameters with quotes (project path may contain spaces)
"%NSSM%" set "%SERVICE_NAME%" AppParameters "\"%ENTRY%\""
"%NSSM%" set "%SERVICE_NAME%" AppDirectory "%PROJECT_DIR%"
"%NSSM%" set "%SERVICE_NAME%" DisplayName "%DISPLAY_NAME%"
"%NSSM%" set "%SERVICE_NAME%" Description "%DESCRIPTION%"
"%NSSM%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START

REM Restart on any exit (crash or clean exit), 5 seconds apart
"%NSSM%" set "%SERVICE_NAME%" AppExit Default Restart
"%NSSM%" set "%SERVICE_NAME%" AppRestartDelay 5000

REM Give the app up to 15 s to shut down gracefully on stop/restart
"%NSSM%" set "%SERVICE_NAME%" AppStopMethodConsole 15000

REM Production mode
"%NSSM%" set "%SERVICE_NAME%" AppEnvironmentExtra NODE_ENV=production

REM Service stdout/stderr capture with rotation (10 MB)
"%NSSM%" set "%SERVICE_NAME%" AppStdout "%LOG_DIR%\service-stdout.log"
"%NSSM%" set "%SERVICE_NAME%" AppStderr "%LOG_DIR%\service-stderr.log"
"%NSSM%" set "%SERVICE_NAME%" AppRotateFiles 1
"%NSSM%" set "%SERVICE_NAME%" AppRotateOnline 1
"%NSSM%" set "%SERVICE_NAME%" AppRotateBytes 10485760

echo.
echo Service %SERVICE_NAME% is installed (not started).
echo Start it with:  "%NSSM%" start %SERVICE_NAME%
echo Status:         "%NSSM%" status %SERVICE_NAME%
echo Logs:           %LOG_DIR%
endlocal
exit /b 0