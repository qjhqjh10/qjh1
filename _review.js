const fs = require("fs");
const files = [
  "src/agent/V4SystemPrompt.ts",
  "src/agent/runtime/V4UnifiedRuntime.ts",
  "src/agent/runtime/ToolActionPrompter.ts",
  "src/agent/context/BridgeContextBuilder.ts",
  "src/agent/V4AnthropicChatBridge.ts",
  "src/agent/V4AgentChatBridge.ts",
  "src/components/ai/AIChatWindow/index.tsx",
  "src/components/pages/ChapterWritingPage/index.tsx",
  "src/agent/skills/tools/toolSearchTools.ts",
  "electron/ipc/projectHandlers.ts"
];

files.forEach(f => {
  const content = fs.readFileSync(f, "utf8");
  const issues = [];

  // 1. Duplicate dynamic imports from same module
  const dynImports = content.match(/await import\([^)]+\)/g) || [];
  const dynMods = {};
  dynImports.forEach(imp => {
    const m = imp.match(/await import\(['"](.+?)['"]\)/);
    if (m) { dynMods[m[1]] = (dynMods[m[1]] || 0) + 1; }
  });
  Object.entries(dynMods).forEach(([mod, count]) => {
    if (count > 1) issues.push("DUPLICATE dynamic import: " + mod + " x" + count);
  });

  // 2. Check for obsolete comments mentioning old version
  if (content.includes("v11.7.1") && !content.includes("v12.6.0")) {
    issues.push("OLD version comment (v11.7.1) with no v12.6.0");
  }
  if (content.includes("核心7个") || content.includes("7个核心")) {
    issues.push("OLD comment: mentions 7 tools (now 10)");
  }
  if (content.includes("15个") && f.includes("Bridge")) {
    issues.push("OLD comment: mentions 15 tools (now 10)");
  }

  // 3. Check for __FULL_REPLACE__ consistency
  if ((content.match(/__FULL_REPLACE__/g) || []).length > 0) {
    // OK - used correctly
  }

  if (issues.length > 0) {
    console.log("\n" + f + ":");
    issues.forEach(i => console.log("  ⚠️ " + i));
  } else {
    console.log(f + ": ✅");
  }
});
