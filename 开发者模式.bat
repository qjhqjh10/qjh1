@echo off
cd /d "%~dp0"
echo AI写作助手 - 开发者模式
echo.
REM 清除 ELECTRON_RUN_AS_NODE，防止 Electron 退化为 Node.js 模式
set ELECTRON_RUN_AS_NODE=
echo 正在启动开发服务器...
call npm run dev
pause
