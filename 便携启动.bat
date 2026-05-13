@echo off
title AI 小说写作助手 - 便携版
cd /d "%~dp0"

set ELECTRON_RUN_AS_NODE=

echo ========================================
echo   AI 小说写作助手 v1.0  便携版
echo ========================================
echo.

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] 找不到 electron.exe
    pause
    exit /b 1
)

if not exist "dist-electron\main.js" (
    echo [ERROR] 找不到 dist-electron\main.js，请先运行 启动AI写作助手.bat
    pause
    exit /b 1
)

echo 启动应用中，请勿关闭此窗口...
echo.
echo 提示: 换电脑后 API 密钥需要重新输入
echo.

"%~dp0node_modules\electron\dist\electron.exe" "%~dp0dist-electron\main.js"

pause
