// ── TaskPipeline Tests ──
// Tests for the Client Pre-filter → Classifier → Intent+Plan pipeline.

import { describe, it, expect } from 'vitest'
import { prefilterClient, parseClassification, CLASSIFIER_PROMPT } from '../pipeline/TaskClassifier'
import { parseIntent, parsePlan as parseMergedPlan, INTENT_PLAN_PROMPT } from '../pipeline/IntentAnalyzer'
import { parsePlan as parseSimplePlan, PLAN_ONLY_PROMPT } from '../pipeline/PlanDesigner'

// ── Client Pre-filter ──

describe('prefilterClient', () => {
  it('routes greetings to direct', () => {
    expect(prefilterClient('你好')?.suggestedRoute).toBe('direct')
    expect(prefilterClient('谢谢你的帮助')?.suggestedRoute).toBe('direct')
    expect(prefilterClient('好的我试试')?.suggestedRoute).toBe('direct')
    expect(prefilterClient('hi there')?.suggestedRoute).toBe('direct')
  })

  it('routes simple queries to simplified', () => {
    const r = prefilterClient('列出所有角色')
    expect(r?.suggestedRoute).toBe('simplified')
    expect(r?.taskType).toBe('simple_query')
  })

  it('returns null for task messages (let LLM classify)', () => {
    expect(prefilterClient('续写第3章的高潮部分')).toBeNull()
    expect(prefilterClient('分析整本小说的情节逻辑')).toBeNull()
  })

  it('returns null for ambiguous messages', () => {
    expect(prefilterClient('帮我想想这个故事应该怎么发展')).toBeNull()
  })

  it('handles empty/whitespace', () => {
    expect(prefilterClient('')).toBeNull()
    expect(prefilterClient('   ')).toBeNull()
  })
})

// ── Classifier Parsing ──

describe('parseClassification', () => {
  it('parses simple_chat classification', () => {
    const result = parseClassification('{"isComplexTask":false,"taskType":"simple_chat","reasoning":"greeting","estimatedComplexity":"low","suggestedRoute":"direct"}')
    expect(result.isComplexTask).toBe(false)
    expect(result.taskType).toBe('simple_chat')
    expect(result.suggestedRoute).toBe('direct')
  })

  it('parses chapter_writing classification', () => {
    const result = parseClassification('{"isComplexTask":true,"taskType":"chapter_writing","reasoning":"user wants to write","estimatedComplexity":"medium","suggestedRoute":"full"}')
    expect(result.isComplexTask).toBe(true)
    expect(result.taskType).toBe('chapter_writing')
    expect(result.suggestedRoute).toBe('full')
  })

  it('falls back to full pipeline on parse failure', () => {
    const result = parseClassification('invalid json')
    expect(result.isComplexTask).toBe(true)
    expect(result.suggestedRoute).toBe('full')
  })

  it('handles JSON wrapped in text', () => {
    const result = parseClassification('some text {"isComplexTask":true,"taskType":"project_analysis","reasoning":"complex","estimatedComplexity":"high","suggestedRoute":"full"} more text')
    expect(result.taskType).toBe('project_analysis')
  })
})

// ── Intent Parsing ──

describe('parseIntent', () => {
  const sampleIntent = '```intent\n{"intent":"续写第3章","goal":{"primary":"完成高潮段落","secondary":["推进主线","埋下伏笔"]},"constraints":{"wordCount":"2000-3000","styleRef":"保持前章风格","characterFocus":"主角","plotRequirements":["反派交锋"],"avoidance":["不揭示反派身份"]},"contextNeeded":{"currentPlot":"主角收到神秘信","characterState":"突破第二层","foreshadowing":"月圆之夜异象"},"isAmbiguous":false,"clarificationQuestions":[],"suggestedApproach":"先读大纲和前章，再创作"}\n```'

  it('parses intent from intent code block', () => {
    const result = parseIntent(sampleIntent)
    expect(result).not.toBeNull()
    expect(result!.intent).toBe('续写第3章')
    expect(result!.goal.primary).toBe('完成高潮段落')
    expect(result!.goal.secondary).toHaveLength(2)
    expect(result!.constraints.plotRequirements).toContain('反派交锋')
    expect(result!.isAmbiguous).toBe(false)
  })

  it('returns null for text without intent block', () => {
    expect(parseIntent('some random text')).toBeNull()
  })
})

// ── Plan Parsing ──

describe('parsePlan (merged)', () => {
  const samplePlan = '```plan\n{"intent":"write chapter 3","steps":[{"id":"step_1","tool":"read_file","action":"read outline","args":{"file_path":"outline/plot.md"},"expectedOutcome":"get outline"}],"neededTools":["read_file"],"estimatedTokens":5000}\n```'

  it('parses plan from plan code block', () => {
    const result = parseMergedPlan(samplePlan)
    expect(result).not.toBeNull()
    expect(result!.intent).toBe('write chapter 3')
    expect(result!.steps).toHaveLength(1)
    expect(result!.steps[0].tool).toBe('read_file')
    expect(result!.steps[0].approvalStatus).toBe('pending')
    expect(result!.estimatedTokens).toBe(5000)
  })

  it('returns null for text without plan block', () => {
    expect(parseMergedPlan('no plan here')).toBeNull()
  })

  it('auto-derives neededTools from steps if not provided', () => {
    const result = parseSimplePlan('```plan\n{"intent":"test","steps":[{"id":"s1","tool":"read_file","action":"read","args":{},"expectedOutcome":"ok"},{"id":"s2","tool":"create_file","action":"create","args":{},"expectedOutcome":"done"}],"estimatedTokens":1000}\n```')
    expect(result?.neededTools).toContain('read_file')
    expect(result?.neededTools).toContain('create_file')
    expect(result?.steps[0].status).toBe('pending')
  })
})

// ── Prompt completeness ──

describe('prompts', () => {
  it('classifier prompt includes routing instructions', () => {
    expect(CLASSIFIER_PROMPT).toContain('任务分类器')
    expect(CLASSIFIER_PROMPT).toContain('direct')
    expect(CLASSIFIER_PROMPT).toContain('full')
  })

  it('intent+plan prompt includes both stages', () => {
    expect(INTENT_PLAN_PROMPT).toContain('意图分析')
    expect(INTENT_PLAN_PROMPT).toContain('执行方案')
    expect(INTENT_PLAN_PROMPT).toContain('```intent')
    expect(INTENT_PLAN_PROMPT).toContain('```plan')
  })

  it('plan-only prompt includes design principles', () => {
    expect(PLAN_ONLY_PROMPT).toContain('方案设计师')
    expect(PLAN_ONLY_PROMPT).toContain('```plan')
  })
})
