@echo off
cd /d "%~dp0"
echo AI小说写作助手 - 开发者模式
echo.
echo 正在构建最新代码...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo 构建失败！
  pause
  exit /b 1
)
echo.
echo 构建成功，正在启动...
REM 清除 ELECTRON_RUN_AS_NODE，防止 Electron 退化为 Node.js 模式
set ELECTRON_RUN_AS_NODE=
call node_modules\.bin\electron.cmd .
pause
