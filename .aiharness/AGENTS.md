# Harness 配置目录

## 结构

```
.aiharness/
├── aiharness.json              ← 主配置文件（权限/工具/Hook/预算/评估）
├── rules/                      ← 项目规则（Markdown，会话时注入）
│   ├── *.md                    ← 手动编写的规则
│   ├── auto-learned/           ← Agent 自动学习的技能
│   │   └── rule_*.json         ← LivingSkill JSON 格式
│   └── auto-generated/         ← RuleExtractor 生成的规则
├── hooks/                      ← Hook 脚本（PreToolUse/PostToolUse 等）
│   └── *.mjs                   ← Node.js 脚本，exit code 2 = 阻断
├── evaluators/                 ← Gatekeeper 验证脚本
│   └── *.mjs
├── garbage/                    ← 被垃圾回收的过期技能（非永久删除）
└── learned/                    ← SkillLearner 持久化的错误模式
```

## 工具

- `list_rules` — 列出所有已学习规则
- `learn_rule` — 从经验中学习并持久化规则
- `update_config` — 修改 aiharness.json 配置
