@echo off
cd /d "%~dp0"
echo AI写作助手 - 开发者模式
echo.
set ELECTRON_RUN_AS_NODE=
echo 正在构建...
call npx electron-vite build
echo.
echo 正在启动...
call npm run dev
pause
