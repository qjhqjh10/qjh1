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
import type { ToolDefinition } from '../types'

// v13.2.0: 27 工具（移除 lsp_diagnose/update_config/list_audit）。首轮全量，后续 11 核心。
export const CORE_TOOLS_COUNT = CORE_TOOL_NAMES.size
export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 9 tools
  ...kbTools,        // 3 tools
  ...noteTools,      // 1 tool
  ...imageTools,     // 2 tools
  ...templateTools,  // 1 tool
  ...projectTools,   // 2 tools
  ...promptTools,    // 3 tools
  ...harnessTools,   // 1 tool
  ...httpTools,      // 2 tools
  ...browserTools,   // 2 tools
  ...toolSearchTools, // 1 tool: tool_search
]

export {
  fileTools, kbTools, noteTools, imageTools, templateTools,
  projectTools, promptTools, harnessTools, httpTools, browserTools,
  toolSearchTools,
}
