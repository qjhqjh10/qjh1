#!/usr/bin/env node
/**
 * Example Hook: validate-json
 * Event: PostToolUse (onMatch: write_note)
 * Strategy: warn — warns if content is not valid JSON when expected
 *
 * Reads context from HOOK_CONTEXT env var.
 * Exit code 0 = pass, code 2 = block.
 */

const ctxJson = process.env.HOOK_CONTEXT || '{}'
const ctx = JSON.parse(ctxJson)

// Check if a write_note or create_file produced valid JSON content
const args = ctx.toolArgs || {}
const result = ctx.toolResult || {}
const content = args.content || ''

if (typeof content === 'string' && content.trim().startsWith('{')) {
  try {
    JSON.parse(content)
    process.stderr.write('JSON validation: valid\n')
  } catch (e) {
    process.stderr.write(`JSON validation WARNING: invalid JSON — ${e.message}\n`)
    // Exit code 0 = warn (passes but warns), not block
  }
}

process.exit(0)
