// ── Tool Aggregator ──
// Aggregates all 41 self-contained skill-system tools across 12 categories.
// Import from individual category modules and re-export as a flat array.

import { fileTools } from './fileTools'
import { kbTools } from './kbTools'
import { noteTools } from './noteTools'
import { imageTools } from './imageTools'
import { templateTools } from './templateTools'
import { projectTools } from './projectTools'
import { promptTools } from './promptTools'
import { harnessTools } from './harnessTools'
import { httpTools } from './httpTools'
import { browserTools } from './browserTools'
import { shellTools } from './shellTools'
import { lspTools } from './lspTools'
import { thinkTools } from './thinkTools'
import { invokeSkillTool } from './skillTools'

import type { ToolDefinition } from '../types'

export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 9 tools:  list_directory, read_file, search_content, edit_file, batch_replace, create_file, delete_file, rename_file, find_files
  ...kbTools,        // 4 tools:  kb_list, kb_create_file, kb_append_file, kb_index_file
  ...noteTools,      // 6 tools:  list_notes, read_note, write_note, append_note, delete_note, search_notes
  ...imageTools,     // 2 tools:  search_images, generate_image
  ...templateTools,  // 2 tools:  create_style_template, create_scene_template
  ...projectTools,   // 2 tools:  create_project, delete_project
  ...promptTools,    // 3 tools:  list_prompts, toggle_prompt, update_prompt
  ...harnessTools,   // 5 tools:  list_rules, learn_rule, update_config, list_audit, write_learning
  ...httpTools,      // 2 tools:  http_get, http_fetch
  ...browserTools,   // 2 tools:  browser_open, browser_search
  ...shellTools,     // 2 tools:  shell_exec, shell_run_script
  ...lspTools,       // 1 tool:   lsp_diagnose
  ...thinkTools,     // 1 tool:   think
  invokeSkillTool,   // 1 tool:   invoke_skill (v9.6.1: Skill 主动调用)
  // Total: 42 tools
]

export {
  fileTools,
  kbTools,
  noteTools,
  imageTools,
  templateTools,
  projectTools,
  promptTools,
  harnessTools,
  httpTools,
  browserTools,
  shellTools,
  lspTools,
  thinkTools,
}
