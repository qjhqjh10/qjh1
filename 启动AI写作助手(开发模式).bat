@echo off
chcp 65001 >nul
title AI 小说写作助手 - 开发模式

cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════╗
echo ║    AI 小说写作助手 - 开发模式       ║
echo ║    (支持热更新，修改代码自动刷新)    ║
echo ╚══════════════════════════════════════╝
echo.

set ELECTRON_RUN_AS_NODE=

echo 正在启动开发服务器...
echo 请勿关闭此窗口！
echo.

npx electron-vite dev

pause
