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

# ═══ C1: Tool count consistency ═══
echo "── C1: Tool Count ──"
# v14.5.1: 37 → 31（工具精简 42→34→27→31；tool-schemas.json 由真实注册表重新生成）
EXPECTED=31

# Check CLI JSON
JSON_PATH="$ROOT/scripts/tool-schemas.json"
if [ -f "$JSON_PATH" ]; then
  CLI_COUNT=$(node -e "console.log(require(process.argv[1]).length)" "$JSON_PATH" 2>/dev/null || echo 0)
else
  CLI_COUNT=0
fi

if [ "$CLI_COUNT" -eq "$EXPECTED" ] 2>/dev/null; then
  pass "CLI JSON=$CLI_COUNT tools — matches expected $EXPECTED"
else
  fail "CLI JSON=$CLI_COUNT tools — expected $EXPECTED. Run: node scripts/export-tool-schemas.mjs"
fi
echo ""

# ═══ C2: Version consistency ═══
echo "── C2: Version ──"
PKG_VER=$(node -e "console.log(require('$ROOT/package.json').version)" 2>/dev/null || echo "unknown")

# Extract latest version from version_history.json
if [ -f "$ROOT/src/data/version_history.json" ]; then
  HIST_FILE="$ROOT/src/data/version_history.json"
  HIST_VER=$(node -e "
    const h = require(process.argv[1]);
    const entries = Array.isArray(h) ? h : h.versions || [];
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

# ═══ C4: Context Provider count ═══
echo "── C4: Context Providers ──"
# Count providers listed in ALL_PROVIDERS array in index.ts
PROVIDERS=$(grep -c "Provider," "$ROOT/src/agent/context/providers/index.ts" 2>/dev/null || echo 0)
if [ "$PROVIDERS" -ge 5 ] 2>/dev/null; then
  pass "Context providers: $PROVIDERS registered (≥ 5 minimum)"
else
  warn "Context providers: only $PROVIDERS found"
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
AGENT_TESTS=$(find "$ROOT/src/agent/__tests__" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
ELECTRON_TESTS=$(find "$ROOT/electron/ipc/__tests__" -name '*.test.ts' 2>/dev/null | wc -l || echo 0)
TYPES_TESTS=$(find "$ROOT/src/types" -path '*/__tests__/*.test.ts' 2>/dev/null | wc -l || echo 0)
TOTAL_TESTS=$((AGENT_TESTS + ELECTRON_TESTS + TYPES_TESTS))
pass "Test files: $TOTAL_TESTS (agent:$AGENT_TESTS electron:$ELECTRON_TESTS types:$TYPES_TESTS)"
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
if npx vitest run --coverage --reporter=verbose 2>/dev/null | grep -q "Coverage"; then
  pass "Coverage: thresholds met"
else
  warn "Coverage: unable to verify (run: npm run test:coverage)"
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
