#!/bin/bash
# Harness 配置一致性检查
# 用法: bash scripts/check-harness.sh
# 退出码 0 = 通过, 1 = 失败

set -e
HARNESS_DIR=".aiharness"
CONFIG="$HARNESS_DIR/aiharness.json"
ERRORS=0

echo "=== Harness 配置检查 ==="

# C1: 配置文件 JSON 格式有效
if [ -f "$CONFIG" ]; then
  if node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));console.log('OK')" 2>/dev/null; then
    echo "✅ C1: aiharness.json 格式有效"
  else
    echo "❌ C1: aiharness.json JSON 格式无效"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "⚠️  C1: aiharness.json 不存在（将使用默认配置）"
fi

# C2: hooks 引用的脚本文件存在
if [ -f "$CONFIG" ]; then
  HOOK_CMDS=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));(c.hooks||[]).forEach(h=>{if(h.command)console.log(h.command)})}catch(e){}" 2>/dev/null)
  for cmd in $HOOK_CMDS; do
    if [ -f "$HARNESS_DIR/hooks/$cmd" ]; then
      echo "✅ C2: Hook 脚本存在 — $cmd"
    else
      echo "❌ C2: Hook 脚本缺失 — $cmd"
      ERRORS=$((ERRORS+1))
    fi
  done
fi

# C3: evaluators threshold 在 0-1 范围
if [ -f "$CONFIG" ]; then
  BAD_THRESHOLDS=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));(c.evaluators||[]).forEach(e=>{if(e.passThreshold<0||e.passThreshold>1)console.log(e.dimension+':'+e.passThreshold)})}catch(e){}" 2>/dev/null)
  if [ -z "$BAD_THRESHOLDS" ]; then
    echo "✅ C3: 评估器阈值在有效范围"
  else
    echo "❌ C3: 评估器阈值越界 — $BAD_THRESHOLDS"
    ERRORS=$((ERRORS+1))
  fi
fi

# C4: policies toolName 不为空
if [ -f "$CONFIG" ]; then
  BAD_POLICIES=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf-8'));(c.permissions?.policies||[]).forEach(p=>{if(!p.toolName)console.log(p.id)})}catch(e){}" 2>/dev/null)
  if [ -z "$BAD_POLICIES" ]; then
    echo "✅ C4: 权限策略 toolName 有效"
  else
    echo "❌ C4: 权限策略缺少 toolName — $BAD_POLICIES"
    ERRORS=$((ERRORS+1))
  fi
fi

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ Harness 配置检查通过"
  exit 0
else
  echo "❌ 发现 $ERRORS 个问题"
  exit 1
fi
