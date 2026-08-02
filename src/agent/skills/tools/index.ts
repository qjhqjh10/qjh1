// ── Tool Aggregator ──
// Aggregates all 27 self-contained skill-system tools across 11 categories.
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
import { toolSearchTools, CORE_TOOL_NAMES } from './toolSearchTools'
import { subagentTools } from './subagentTools'
import type { ToolDefinition } from '../types'

// v13.2.0: 27 工具（移除 lsp_diagnose/update_config/list_audit）。首轮全量，后续 15 核心。
// v14.9(清理): 注释同步——SUBSEQUENT_TOOL_NAMES 现为 16（v14.8 加入 kb_analyze 后注释未更新）。
// v14.1.1: +analyze_file/edit_file_task → 29；v14.2.0: +verify_task → 30；v14.3.0: +subagent_ask → 31；
// v14.8.0: +kb_analyze → 32（v14.8 审查修复：注释同步）
export const CORE_TOOLS_COUNT = CORE_TOOL_NAMES.size
export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 9 tools
  ...kbTools,        // 4 tools: kb_search / kb_analyze / kb_append_file / kb_index_file
  ...noteTools,      // 1 tool
  ...imageTools,     // 2 tools
  ...templateTools,  // 1 tool
  ...projectTools,   // 2 tools
  ...promptTools,    // 3 tools
  ...harnessTools,   // 1 tool
  ...httpTools,      // 2 tools
  ...browserTools,   // 2 tools
  ...toolSearchTools, // 1 tool: tool_search
  ...subagentTools,  // v14.8: 4 tools: analyze_file / edit_file_task / verify_task / subagent_ask
]

export {
  fileTools, kbTools, noteTools, imageTools, templateTools,
  projectTools, promptTools, harnessTools, httpTools, browserTools,
  toolSearchTools, subagentTools,
}
