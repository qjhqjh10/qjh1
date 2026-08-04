#!/usr/bin/env bash
# ── 安全分发打包脚本（v15.1 修复）──
# 背景：v15.0.0 绿色便携化后运行数据生成在 release/win-unpacked/userdata/（exe 旁边）。
# 若直接把 win-unpacked 打 zip 分发，会把本机对话记录/配置/项目数据带出去——
# 既泄漏隐私，又让对方机器带着"僵尸配置"启动（localStorage 旧配置 + electron-store 空配置
# 不合并 → 显示旧配置、刷新模型报错）。
#
# 用法: bash scripts/package-dist.sh [版本号]     （版本号缺省读 package.json）
# 输出: release/win-unpacked-<version>.zip（已复检不含 userdata）
# 依赖: Git Bash（zip 逻辑用 node + 项目自带 archiver，无需系统 zip 命令）

set -e
cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
ZIP_NAME="win-unpacked-${VERSION}.zip"

echo "══ 1/6 打包前检查: tsc + 打包安全测试 ══"
npx tsc --noEmit
npx vitest run tests/PackagingSafety.test.ts

echo "══ 2/6 构建 (electron-vite build) ══"
npm run build

echo "══ 3/6 electron-builder --dir ══"
npx electron-builder --dir

echo "══ 4/6 清理运行时数据 userdata/ ══"
rm -rf "release/win-unpacked/userdata"
if [ ! -d "release/win-unpacked/userdata" ]; then
  echo "  ✓ userdata 已清理（对话记录/配置/项目数据不会进入分发包）"
else
  echo "  🔴 userdata 清理失败——终止"
  exit 1
fi

echo "══ 5/6 产物完整性验证 ══"
DLL_COUNT=$(ls release/win-unpacked/*.dll 2>/dev/null | grep -c "node" || true)
echo "  node*.dll 数量: $DLL_COUNT（0 = v14.7.0 解压事故复现，必须终止）"
[ "$DLL_COUNT" -lt 1 ] && { echo "  🔴 node.dll 缺失——终止"; exit 1; }
[ -f "release/win-unpacked/AI写作软件—青剑.exe" ] || { echo "  🔴 主 exe 缺失——终止"; exit 1; }
echo "  ✓ exe 与 node.dll 就位"

echo "══ 6/6 打包 zip + 防泄漏复检 ══"
cd release
rm -f "$ZIP_NAME"
node ../scripts/zip-dist.mjs "$VERSION"
if unzip -l "$ZIP_NAME" >/dev/null 2>&1 && unzip -l "$ZIP_NAME" | grep -q "win-unpacked/userdata"; then
  echo "  🔴 zip 仍包含 userdata——终止（需人工介入）"
  rm -f "$ZIP_NAME"
  exit 1
fi
echo ""
echo "✅ 完成: release/$ZIP_NAME"
echo "   （zip 内已确认无 userdata：对方机器将以全新配置启动，不再出现僵尸配置/刷新报错）"
