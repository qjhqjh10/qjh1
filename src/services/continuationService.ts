// 注意：本文件是【续写提示词构建器】的转发层（barrel）——与 fileService.ts 中同名
// continuationService（IPC 数据存取包装：list/read/save/delete）职责不同、互不冲突。
// 页面中 `import { continuationService } from '@/services/fileService'` 取数据包装；
// 本模块只导出 analysisPrompts 的提示词构建函数。请勿合并两处。
export {
  buildChapterAnalysisPrompt, buildAggregationPrompt, buildBatchSummaryPrompt,
  buildGlobalAggregationPrompt, buildPlotDirectionPrompt, buildContinuationPlotPrompt,
  buildOutlineMergePrompt, buildContinuationPlanPrompt, buildContinuationWritingPrompt,
  buildSegmentChapterPlansPrompt,
} from './continuationService/analysisPrompts'

