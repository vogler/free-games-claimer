@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: =====================================================================
::                                                                      ::
::   ██╗████████╗███████╗███╗   ███╗ █████╗ ███████╗                    ::
::   ██║╚══██╔══╝╚══███╔╝████╗ ████║██╔══██╗██╔════╝                    ::
::   ██║   ██║     ███╔╝ ██╔████╔██║███████║███████╗                    ::
::   ██║   ██║    ███╔╝  ██║╚██╔╝██║██╔══██║╚════██║                    ::
::   ██║   ██║   ███████╗██║ ╚═╝ ██║██║  ██║███████║                    ::
::   ╚═╝   ╚═╝   ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝                    ::
::                                                                      ::
::                              iTzMAS                                  ::
::                                                                      ::
:: =====================================================================
::                                                                      ::
::  Free Games Claimer Manager                                          ::
::  Dev Branch Auto Installer / Updater                                 ::
::
::  Copyright (c) 2026 iTzMAS
::  Created by iTzMAS
::
::  This script is provided for personal use.
::  Redistribution or modification without permission is prohibited.
::
:: =====================================================================


set "REPO=https://github.com/vogler/free-games-claimer.git"
set "BRANCH=dev"


echo.
echo ========================================
echo Free Games Claimer Manager
echo ========================================
echo.


:: ------------------------------------------------------------
:: Check required programs
:: ------------------------------------------------------------

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or not in PATH.
    echo Install Git for Windows first.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)


:: ------------------------------------------------------------
:: Detect installation location
:: ------------------------------------------------------------

cd /d "%~dp0"


:: Current folder is already the repository
if exist ".git" (
    git rev-parse --is-inside-work-tree >nul 2>&1
    if not errorlevel 1 (
        echo Found installation in current folder.
        goto UPDATE
    )
)


:: Check subfolder installation
if exist "free-games-claimer\.git" (
    echo Found installation in free-games-claimer folder.
    cd /d "%~dp0free-games-claimer"
    goto UPDATE
)


:: ------------------------------------------------------------
:: First installation
:: ------------------------------------------------------------

echo No existing installation found.
echo.

echo Installing Free Games Claimer...

mkdir "%~dp0free-games-claimer" 2>nul
cd /d "%~dp0free-games-claimer"


git clone --branch "%BRANCH%" --single-branch "%REPO%" .

if errorlevel 1 (
    echo.
    echo Clone failed.
    pause
    exit /b 1
)


echo.
echo Installing Node dependencies...

call npm install

if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
)

goto START



:: ------------------------------------------------------------
:: Update existing installation
:: ------------------------------------------------------------

:UPDATE

echo.
echo Checking for updates...

git fetch origin "%BRANCH%"


for /f %%A in ('git rev-parse HEAD') do set "LOCAL=%%A"
for /f %%A in ('git rev-parse origin/%BRANCH%') do set "REMOTE=%%A"


if "!LOCAL!"=="!REMOTE!" (
    echo Already up to date.
    goto START
)


echo Update detected.


:: Check if dependencies changed
git diff --name-only HEAD origin/%BRANCH% > "%TEMP%\fgc_changed.txt"


findstr /I /C:"package.json" /C:"package-lock.json" "%TEMP%\fgc_changed.txt" >nul

if not errorlevel 1 (
    set "NEEDS_NPM=1"
)


del "%TEMP%\fgc_changed.txt" >nul 2>&1


echo Updating files...

git reset --hard origin/%BRANCH%

if errorlevel 1 (
    echo Update failed.
    pause
    exit /b 1
)


if defined NEEDS_NPM (
    echo.
    echo Dependencies changed.
    echo Running npm install...

    call npm install

    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)


echo.
echo Update complete.



:: ------------------------------------------------------------
:: Start application
:: ------------------------------------------------------------

:START

echo.
echo ========================================
echo Starting Epic Games Claimer...
echo ========================================
echo.

node epic-games


endlocal