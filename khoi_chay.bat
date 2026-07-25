@echo off
title Bo Khoi Chay IoT Rogue Device Detector
:: Kiem tra quyen Administrator
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"

if '%errorlevel%' NEQ '0' (
    echo Dang yeu cau quyen quan tri vien (Administrator)...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    if exist "%temp%\getadmin.vbs" ( del "%temp%\getadmin.vbs" )
    pushd "%~dp0"

    echo ============================================================
    echo   KHOI CHAY HE THONG PHAT HIEN THIET BI IOT TRAI PHEP
    echo ============================================================
    :: Tu dong phat hien trinh khoi chay phu hop (py hoac python)
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set PYTHON_CMD=py
    ) else (
        set PYTHON_CMD=python
    )

    echo [*] Dang khoi chay Python Backend am tham bang lenh: %PYTHON_CMD% scanner.py...
    
    :: Khoi chay scanner.py va an cua so xuong taskbar
    start "IoT_Python_Backend" /min %PYTHON_CMD% scanner.py
    
    echo [*] Dang doi API Server khoi dong (3 giay)...
    timeout /t 3 /nobreak >nul
    
    echo [*] Dang mo giao dien Web Dashboard...
    start index.html
    
    echo [OK] Hoan tat! Giao dien Web da duoc lien ket va mo tren trinh duyet.
    echo [!] Vui long GIU cua so nay hoac cua so Python duoi thanh taskbar trong khi su dung.
    echo ============================================================
    timeout /t 5 >nul
    exit
