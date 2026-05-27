@echo off
REM ── AI 写作助手 — 一键初始化脚本 (Windows) ──

echo ═══════════════════════════════════════
echo  AI 写作助手 — 环境初始化
echo ═══════════════════════════════════════
echo.

REM 1. Node.js check
echo ── 检查 Node.js ──
where node >nul 2>&1
if errorlevel 1 (
  echo ❌ 未找到 Node.js，请安装 Node.js >= 18
  exit /b 1
)
for /f "tokens=1 delims=." %%i in ('node -v') do set NODE_MAJOR=%%i
echo ✅ Node.js %NODE_MAJOR% 已就绪

REM 2. npm install
echo.
echo ── 安装依赖 ──
call npm install
echo ✅ 依赖安装完成

REM 3. Create directories
echo.
echo ── 初始化 .aiharness/ ──
if not exist ".aiharness\rules\auto-learned" mkdir ".aiharness\rules\auto-learned"
if not exist ".aiharness\hooks" mkdir ".aiharness\hooks"
if not exist ".aiharness\evaluators" mkdir ".aiharness\evaluators"
if not exist ".aiharness\scripts" mkdir ".aiharness\scripts"
if not exist ".aiharness\feedback" mkdir ".aiharness\feedback"
if not exist ".aiharness\tool-results" mkdir ".aiharness\tool-results"
echo ✅ 目录结构就绪

REM 4. Generate schemas
echo.
echo ── 生成工具 Schema ──
node scripts\export-tool-schemas.mjs 2>nul
echo ✅ 工具 schema 就绪

REM 5. Tests
echo.
echo ── 运行测试 ──
call npx vitest run --reporter=verbose
echo ✅ 测试完成

echo.
echo ═══════════════════════════════════════
echo  ✅ 初始化完成！
echo  npm run dev 启动开发模式
echo ═══════════════════════════════════════
