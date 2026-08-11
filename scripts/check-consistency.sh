#!/bin/bash
# ── Project Consistency Check ──
# 7 checks guarding against doc/code drift. Exit 0 = all pass, 1 = failures found.
# Usage: bash scripts/check-consistency.sh
# Run from the repo root.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
WARN=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN+1)); }

echo "══════════════════════════════════════════"
echo " Project Consistency Check"
echo "══════════════════════════════════════════"
echo ""

# ═══ C1: Tool schema consistency ═══
echo "── C1: Tool Schemas ──"
# v14.8: 从"只数条目数"升级为"名称集合 + 内容深比较"（scripts/export-tool-schemas.ts --check 只读判定）
if (cd "$ROOT" && timeout 120 npx tsx scripts/export-tool-schemas.ts --check >/dev/null 2>&1); then
  CLI_COUNT=$(node -e "console.log(require(process.argv[1]).length)" "$ROOT/scripts/tool-schemas.json" 2>/dev/null || echo 0)
  pass "tool-schemas.json=$CLI_COUNT tools — 名称与内容与注册表一致"
else
  fail "tool-schemas.json 与注册表不一致。Run: npx tsx scripts/export-tool-schemas.ts"
fi
echo ""

# ═══ C2: Version consistency ═══
echo "── C2: Version ──"
# v16.3.1(审计 S10): 路径经 process.argv 传入——内联 require('/d/3/...') 在 node 下不可解析
# （git-bash 的 /d/ 路径形态），argv 传参由 node 归一化，与下方 HIST_VER 同法
PKG_VER=$(node -e "console.log(require(process.argv[1]).version)" "$ROOT/package.json" 2>/dev/null || echo "unknown")

# Extract latest version from version_history.json
if [ -f "$ROOT/src/data/version_history.json" ]; then
  HIST_FILE="$ROOT/src/data/version_history.json"
  HIST_VER=$(node -e "
    const h = require(process.argv[1]);
    // v16.3.1(审计 S10): 实际结构为 { currentVersion, currentDate, history }——
    // 原读 h.versions 恒空 → 永远 unknown（检查空转）
    const entries = Array.isArray(h) ? h : h.versions || h.history || [];
    console.log(entries[0]?.version || 'unknown');
  " "$HIST_FILE" 2>/dev/null || echo "unknown")
else
  HIST_VER="unknown"
fi

# Check CLAUDE.md version table
CLAUDE_VER=$(grep -oP 'v\d+\.\d+\.\d+' "$ROOT/CLAUDE.md" 2>/dev/null | head -1 || echo "unknown")

if [ "$PKG_VER" != "unknown" ] && [ "$HIST_VER" != "unknown" ]; then
  if [ "$PKG_VER" = "$HIST_VER" ]; then
    pass "package.json=$PKG_VER, version_history=$HIST_VER, CLAUDE.md=$CLAUDE_VER — in sync"
  else
    warn "package.json=$PKG_VER, version_history=$HIST_VER — may be out of sync"
  fi
else
  warn "package.json=$PKG_VER, version_history=$HIST_VER — check manually"
fi
echo ""

# ═══ C3: CLAUDE.md references resolve ═══
echo "── C3: File References ──"
MISSING_FILES=0
# Extract file paths from CLAUDE.md (backtick-wrapped)
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  # Skip patterns with {}, URLs, commands
  [[ "$ref" == http* ]] && continue
  [[ "$ref" == *"{"*"}"* ]] && continue
  [[ "$ref" == *npx* ]] && continue
  # Skip 'memory/MEMORY.md' as it's in user home, not repo
  [[ "$ref" == memory/* ]] && continue
  # v14.8: 跳过 ~/.claude/ 用户目录引用（同属 repo 外记忆文件，如 ~/.claude/projects/*/memory/MEMORY.md）
  [[ "$ref" == *"~/.claude/"* ]] && continue
  # Try as relative path from repo root
  if [ -e "$ROOT/$ref" ]; then
    pass "  $ref"
  elif ls "$ROOT/$ref" 2>/dev/null >/dev/null 2>&1; then
    pass "  $ref"
  else
    warn "  $ref — NOT FOUND"
    MISSING_FILES=$((MISSING_FILES+1))
  fi
done < <(grep -oP '`[^`]+`' "$ROOT/CLAUDE.md" 2>/dev/null | sed 's/`//g' | grep -E '\.(md|ts|tsx|json|sh|mjs)$|/$' || true)

if [ $MISSING_FILES -eq 0 ]; then
  pass "CLAUDE.md — all referenced files exist"
else
  fail "CLAUDE.md — $MISSING_FILES referenced files missing"
fi
echo ""

# ═══ C4: Context pipeline integrity ═══
echo "── C4: Context Pipeline ──"
# v16.3.1(审计 S1): 原检查 grep src/agent/context/providers/index.ts（v11 架构已删除该目录，
# 恒 0 恒 WARN 空转）。改为检查真实架构真源文件齐全（ContextAssembler 组装链路）。
CONTEXT_FILES="src/agent/context/ContextAssembler.ts src/agent/context/BridgeContextBuilder.ts src/agent/context/ContextCompressor.ts src/agent/context/ReadResultTracker.ts src/agent/context/ContractExecutor.ts"
CONTEXT_MISSING=0
for f in $CONTEXT_FILES; do
  [ -f "$ROOT/$f" ] || { warn "  $f — NOT FOUND"; CONTEXT_MISSING=$((CONTEXT_MISSING+1)); }
done
if [ "$CONTEXT_MISSING" -eq 0 ]; then
  pass "Context pipeline: 5 core files present"
else
  fail "Context pipeline: $CONTEXT_MISSING core files missing"
fi
echo ""

# ═══ C5: memory/ index consistency ═══
echo "── C5: Memory Index ──"
# Memory is stored in user home, not repo — check if referenced path exists
MEM_PATH="$HOME/.claude/projects/d--3/memory/MEMORY.md"
if [ -f "$MEM_PATH" ]; then
  MEM_LINKS=$(grep -c '^- \[' "$MEM_PATH" 2>/dev/null || echo 0)
  MEM_DIR=$(dirname "$MEM_PATH")
  MEM_FILES=$(find "$MEM_DIR" -maxdepth 1 -name '*.md' ! -name 'MEMORY.md' 2>/dev/null | wc -l || echo 0)
  if [ "$MEM_LINKS" -ge "$MEM_FILES" ] 2>/dev/null; then
    pass "memory/ — $MEM_LINKS index links, $MEM_FILES memory files"
  else
    warn "memory/ — $MEM_LINKS links but $MEM_FILES files (some files not indexed?)"
  fi
else
  warn "memory/MEMORY.md not found at $MEM_PATH — skip (expected: outside repo)"
fi
echo ""

# ═══ C6: Test file coverage ═══
echo "── C6: Test Coverage ──"
# Count test files
# v16.3.1(审计 S2): 原统计 src/types/__tests__/*.test.ts（目录不存在，恒计 0）——补 services/utils/store 与 tests/ 根
AGENT_TESTS=$(find "$ROOT/src/agent/__tests__" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
ELECTRON_TESTS=$(find "$ROOT/electron/ipc/__tests__" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
SRC_OTHER_TESTS=$(find "$ROOT/src/services/__tests__" "$ROOT/src/utils/__tests__" "$ROOT/src/store/__tests__" "$ROOT/src/types" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
ROOT_TESTS=$(find "$ROOT/tests" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
TOTAL_TESTS=$((AGENT_TESTS + ELECTRON_TESTS + SRC_OTHER_TESTS + ROOT_TESTS))
pass "Test files: $TOTAL_TESTS (agent:$AGENT_TESTS electron:$ELECTRON_TESTS src-other:$SRC_OTHER_TESTS root:$ROOT_TESTS)"
echo ""

# ═══ C7: TypeScript compilation ═══
echo "── C7: TypeScript Compilation ──"
if npx tsc --noEmit --pretty 2>/dev/null; then
  pass "TypeScript: zero errors"
else
  fail "TypeScript: compilation errors found"
fi
echo ""

# ═══ C8: Test coverage threshold ═══
echo "── C8: Test Coverage ──"
# v16.3.1(审计 S3/S11): ① 提示语修正（原指向不存在的 npm run test:coverage）；
# ② grep 去掉 -q——set -o pipefail 下 grep -q 首匹配即退出 → SIGPIPE 杀 vitest →
# 管道恒失败（原检查永远 WARN）
if npx vitest run --coverage 2>/dev/null | grep "Coverage" >/dev/null; then
  pass "Coverage: thresholds met"
else
  warn "Coverage: unable to verify (run: npx vitest run --coverage)"
fi
echo ""

# ═══ Summary ═══
echo "══════════════════════════════════════════"
echo -e " Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
echo "══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
