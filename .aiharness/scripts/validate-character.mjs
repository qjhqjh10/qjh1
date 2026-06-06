#!/usr/bin/env node
/**
 * 验证角色卡 — 检查 16 字段完整性 + 枚举值合法性
 * 用法: node validate-character.mjs <projectRoot>
 * 输出: JSON { status: "pass"|"fail", checks: [...], failedCount: N }
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(process.argv[2] || process.cwd())
const charDir = join(projectRoot, 'characters')

const REQUIRED_FIELDS = [
  'id', 'name', 'role', 'gender', 'age', 'occupation',
  'background', 'appearance', 'personality', 'abilities', 'weaknesses',
  'relationships', 'relationshipTags', 'arc', 'importance', 'image',
]
const VALID_ROLES = ['男主', '女主', '男配', '女配', '反派', '其他']

const checks = []

try {
  if (!existsSync(charDir)) {
    checks.push({ file: 'characters/', check: 'directory_exists', passed: false, reason: '目录不存在' })
  } else {
    const files = readdirSync(charDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    if (files.length === 0) {
      checks.push({ file: 'characters/', check: 'has_files', passed: false, reason: '无 YAML 文件' })
    }

    for (const f of files) {
      const fp = join(charDir, f)
      const check = { file: `characters/${f}`, passed: true, missingFields: [], enumErrors: [], parseError: null }

      try {
        const raw = readFileSync(fp, 'utf-8')
        // Simple YAML parsing: extract key: value pairs (line-based)
        const fields = {}
        const lines = raw.split('\n')
        for (const line of lines) {
          const m = line.match(/^(\w+):\s*(.+)$/)
          if (m) fields[m[1]] = m[2].trim()
        }

        for (const rf of REQUIRED_FIELDS) {
          if (!(rf in fields) || fields[rf] === '') {
            check.missingFields.push(rf)
          }
        }

        // Validate role enum
        if (fields.role) {
          const roleClean = fields.role.replace(/^["']|["']$/g, '').trim()
          if (!VALID_ROLES.includes(roleClean)) {
            // Check if role contains extra description (like "男主/血煞教内应")
            const baseRole = VALID_ROLES.find(r => roleClean.startsWith(r))
            if (baseRole && roleClean !== baseRole) {
              check.enumErrors.push(`role: "${roleClean}" → 应仅为 "${baseRole}"`)
            } else if (!baseRole) {
              check.enumErrors.push(`role: "${roleClean}" → 不在枚举值中`)
            }
          }
        }

        // Validate importance is number
        if (fields.importance && isNaN(Number(fields.importance))) {
          check.enumErrors.push(`importance: "${fields.importance}" → 必须是数字`)
        }

        // Validate relationshipTags is array-like
        if (fields.relationshipTags) {
          const rt = fields.relationshipTags.replace(/^["']|["']$/g, '').trim()
          if (!rt.startsWith('[')) {
            check.enumErrors.push('relationshipTags 必须是数组格式 [tag1, tag2]')
          }
        }

        check.passed = check.missingFields.length === 0 && check.enumErrors.length === 0 && !check.parseError

      } catch (e) {
        check.parseError = e.message
        check.passed = false
      }

      checks.push(check)
    }
  }
} catch (e) {
  checks.push({ file: 'characters/', check: 'directory_accessible', passed: false, reason: e.message })
}

const failedCount = checks.filter(c => !c.passed).length
console.log(JSON.stringify({ status: failedCount === 0 ? 'pass' : 'fail', checks, failedCount }))
