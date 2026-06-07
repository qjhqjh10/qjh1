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
import type { ToolDefinition } from '../types'

// v11.5: Unified create_file/edit_file/read_file/delete_file. 34 tools (was 42).
export const ALL_TOOLS: ToolDefinition[] = [
  ...fileTools,      // 9 tools
  ...kbTools,        // 2 tools (kb_list/kb_create_file removed)
  ...noteTools,      // 1 tool (all note CRUD removed — use create_file/edit_file)
  ...imageTools,     // 2 tools
  ...templateTools,  // 2 tools
  ...projectTools,   // 2 tools
  ...promptTools,    // 3 tools
  ...harnessTools,   // 5 tools
  ...httpTools,      // 2 tools
  ...browserTools,   // 2 tools
  ...shellTools,     // 2 tools
  ...lspTools,       // 1 tool
  ...thinkTools,     // 1 tool
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
