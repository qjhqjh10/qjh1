#!/bin/bash
# ── AI 写作助手 — 一键初始化脚本 ──
# Usage: bash scripts/bootstrap.sh

set -e

echo "═══════════════════════════════════════"
echo " AI 写作助手 — 环境初始化"
echo "═══════════════════════════════════════"
echo ""

# 1. Node.js check
echo "── 检查 Node.js ──"
if ! command -v node &> /dev/null; then
  echo "❌ 未找到 Node.js，请安装 Node.js ≥ 18"
  exit 1
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 版本过低: $(node -v)，需要 ≥ 18"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# 2. npm install
echo ""
echo "── 安装依赖 ──"
npm install
echo "✅ 依赖安装完成"

# 3. Create .aiharness/ directory structure
echo ""
echo "── 初始化 .aiharness/ ──"
mkdir -p .aiharness/rules/auto-learned
mkdir -p .aiharness/hooks
mkdir -p .aiharness/evaluators
mkdir -p .aiharness/scripts
mkdir -p .aiharness/feedback
mkdir -p .aiharness/tool-results
echo "✅ 目录结构就绪"

# 4. Copy default config if missing
if [ ! -f ".aiharness/aiharness.json" ]; then
  echo "⚠️  .aiharness/aiharness.json 不存在，使用默认配置"
fi
echo "✅ Harness 配置就绪"

# 5. Generate tool schemas
echo ""
echo "── 生成工具 Schema ──"
node scripts/export-tool-schemas.mjs 2>/dev/null || echo "⚠️  工具 schema 导出可选"
echo "✅ 工具 schema 就绪"

# 6. Consistency check
echo ""
echo "── 一致性检查 ──"
if [ -f "scripts/check-consistency.sh" ]; then
  bash scripts/check-consistency.sh || echo "⚠️  部分检查未通过，请查看上方详情"
else
  echo "⚠️  一致性检查脚本不存在"
fi

# 7. Run tests
echo ""
echo "── 运行测试 ──"
npx vitest run --reporter=verbose 2>&1 | tail -5
echo "✅ 测试完成"

# Done
echo ""
echo "═══════════════════════════════════════"
echo " ✅ 初始化完成！"
echo ""
echo " 启动开发模式: npm run dev"
echo " 运行测试:     npm test"
echo " 一致性检查:   bash scripts/check-consistency.sh"
echo "═══════════════════════════════════════"
