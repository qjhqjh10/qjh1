@echo off
title AI 小说写作助手
cd /d "%~dp0"

set ELECTRON_RUN_AS_NODE=

echo ========================================
echo      AI 小说写作助手 v1.0
echo ========================================
echo.

echo [1/2] 构建中...
call npx electron-vite build
if %errorlevel% neq 0 (
    echo.
    echo [FAIL] 构建失败，请查看上方错误信息
    echo 如果没有安装 Node.js，请使用 "便携启动.bat"
    pause
    exit /b 1
)
echo [1/2] 构建完成

echo [2/2] 启动应用...
echo.
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0dist-electron\main.js"

pause
