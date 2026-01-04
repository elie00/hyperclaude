// src/smart-suggestions.ts
import * as fs from "fs";
import * as path from "path";
var AGENT_PATTERNS = {
  "debug-agent": {
    keywords: ["error", "bug", "fail", "crash", "broken", "fix", "issue", "wrong", "not working"],
    filePatterns: [/\.log$/, /error/i, /debug/i],
    contextSignals: ["errorDetected", "testFailed"],
    description: "Debug and fix issues"
  },
  "research-agent": {
    keywords: ["how to", "best practice", "example", "learn", "understand", "what is", "documentation"],
    filePatterns: [/README/, /\.md$/],
    contextSignals: ["researchContext", "newLibrary"],
    description: "Research and gather information"
  },
  "plan-agent": {
    keywords: ["plan", "design", "architect", "structure", "approach", "strategy", "implement"],
    filePatterns: [/\.md$/, /plan/i, /design/i],
    contextSignals: ["implementContext", "newFeature"],
    description: "Create implementation plans"
  },
  "rp-explorer": {
    keywords: ["explore", "codebase", "understand", "navigate", "find", "where is", "how does"],
    filePatterns: [],
    contextSignals: ["largeCodebase", "unfamiliarCode"],
    description: "Explore codebase efficiently"
  },
  "validate-agent": {
    keywords: ["check", "verify", "validate", "review", "test", "correct", "ensure"],
    filePatterns: [/test/, /spec/],
    contextSignals: ["testContext", "preCommit"],
    description: "Validate implementation against requirements"
  },
  "codebase-analyzer": {
    keywords: ["analyze", "trace", "flow", "dependency", "deep dive", "how does X work"],
    filePatterns: [],
    contextSignals: ["complexCode", "architectureQuestion"],
    description: "Deep analysis of code patterns"
  }
};
var SKILL_PATTERNS = {
  "tdd-workflow": {
    keywords: ["test", "tdd", "red green", "failing test"],
    contextSignals: ["testContext", "implementContext"]
  },
  "commit": {
    keywords: ["commit", "save", "push", "git"],
    contextSignals: ["changesReady"]
  },
  "create_handoff": {
    keywords: ["done", "finish", "handoff", "end session", "wrap up"],
    contextSignals: ["highContext", "taskComplete"]
  },
  "continuity_ledger": {
    keywords: ["save state", "update ledger", "before clear"],
    contextSignals: ["mediumContext"]
  }
};
function analyzeContext(projectDir, prompt, recentFiles = []) {
  const analysis = {
    fileTypes: [],
    recentTools: [],
    ledgerPhase: null,
    errorDetected: false,
    testContext: false,
    researchContext: false,
    implementContext: false,
    debugContext: false
  };
  const lowerPrompt = prompt.toLowerCase();
  analysis.errorDetected = /error|fail|bug|crash|broken|exception|not working/i.test(prompt);
  analysis.testContext = /test|spec|jest|pytest|vitest/i.test(prompt);
  analysis.researchContext = /how to|what is|best practice|example|documentation/i.test(prompt);
  analysis.implementContext = /implement|create|add|build|make/i.test(prompt);
  analysis.debugContext = /debug|fix|investigate|why|wrong/i.test(prompt);
  for (const file of recentFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!analysis.fileTypes.includes(ext)) {
      analysis.fileTypes.push(ext);
    }
  }
  try {
    const ledgerDirs = [
      path.join(projectDir, "thoughts", "ledgers"),
      projectDir
    ];
    for (const dir of ledgerDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md"));
        if (files.length > 0) {
          const ledgerPath = path.join(dir, files[0]);
          const content = fs.readFileSync(ledgerPath, "utf-8");
          const nowMatch = content.match(/- Now: ([^\n]+)/);
          if (nowMatch) {
            analysis.ledgerPhase = nowMatch[1].trim();
          }
          break;
        }
      }
    }
  } catch {
  }
  return analysis;
}
function loadHistory(projectDir) {
  const historyPath = path.join(projectDir, ".claude", "cache", "suggestion-history.json");
  if (fs.existsSync(historyPath)) {
    try {
      return JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function recordOutcome(projectDir, agent, outcome, context) {
  const historyPath = path.join(projectDir, ".claude", "cache", "suggestion-history.json");
  const cacheDir = path.dirname(historyPath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const history = loadHistory(projectDir);
  history.push({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    agent,
    outcome,
    context: context.slice(0, 200)
  });
  const trimmed = history.slice(-100);
  fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2));
}
function getHistoryBoost(agent, context, history) {
  const relevant = history.filter((h) => h.agent === agent);
  if (relevant.length === 0) return 0;
  const successes = relevant.filter((h) => h.outcome === "success").length;
  const rate = successes / relevant.length;
  const similarContext = relevant.filter(
    (h) => h.context.toLowerCase().includes(context.toLowerCase().slice(0, 50))
  );
  const contextBoost = similarContext.some((h) => h.outcome === "success") ? 0.2 : 0;
  return rate * 0.3 + contextBoost;
}
function generateSuggestions(projectDir, prompt, recentFiles = [], contextPct = 0) {
  const suggestions = [];
  const context = analyzeContext(projectDir, prompt, recentFiles);
  const history = loadHistory(projectDir);
  const lowerPrompt = prompt.toLowerCase();
  for (const [agentName, patterns] of Object.entries(AGENT_PATTERNS)) {
    let score = 0;
    let reason = "";
    for (const keyword of patterns.keywords) {
      if (lowerPrompt.includes(keyword)) {
        score += 0.3;
        reason = `Detected "${keyword}" in your request`;
        break;
      }
    }
    for (const signal of patterns.contextSignals) {
      if (context[signal]) {
        score += 0.25;
        if (!reason) reason = `Context suggests ${patterns.description.toLowerCase()}`;
      }
    }
    for (const pattern of patterns.filePatterns) {
      if (recentFiles.some((f) => pattern.test(f))) {
        score += 0.15;
      }
    }
    score += getHistoryBoost(agentName, prompt, history);
    if (score >= 0.3) {
      suggestions.push({
        type: "agent",
        name: agentName,
        reason: reason || patterns.description,
        confidence: score >= 0.6 ? "high" : score >= 0.4 ? "medium" : "low",
        priority: Math.round(score * 100)
      });
    }
  }
  for (const [skillName, patterns] of Object.entries(SKILL_PATTERNS)) {
    let score = 0;
    let reason = "";
    for (const keyword of patterns.keywords) {
      if (lowerPrompt.includes(keyword)) {
        score += 0.4;
        reason = `Detected "${keyword}"`;
        break;
      }
    }
    if (skillName === "create_handoff" && contextPct >= 75) {
      score += 0.5;
      reason = `Context at ${contextPct}% - good time for handoff`;
    }
    if (skillName === "continuity_ledger" && contextPct >= 60 && contextPct < 75) {
      score += 0.3;
      reason = `Context at ${contextPct}% - consider saving state`;
    }
    if (score >= 0.3) {
      suggestions.push({
        type: "skill",
        name: skillName,
        reason,
        confidence: score >= 0.6 ? "high" : score >= 0.4 ? "medium" : "low",
        priority: Math.round(score * 100)
      });
    }
  }
  suggestions.sort((a, b) => b.priority - a.priority);
  return suggestions.slice(0, 5);
}
function formatSuggestions(suggestions) {
  if (suggestions.length === 0) return "";
  const highConfidence = suggestions.filter((s) => s.confidence === "high");
  const mediumConfidence = suggestions.filter((s) => s.confidence === "medium");
  let output = "";
  if (highConfidence.length > 0) {
    output += "\u{1F4A1} SUGGESTED:\n";
    for (const s of highConfidence) {
      const icon = s.type === "agent" ? "\u{1F916}" : "\u26A1";
      output += `  ${icon} ${s.name} - ${s.reason}
`;
    }
  }
  if (mediumConfidence.length > 0 && highConfidence.length === 0) {
    output += "\u{1F4AD} CONSIDER:\n";
    for (const s of mediumConfidence.slice(0, 2)) {
      const icon = s.type === "agent" ? "\u{1F916}" : "\u26A1";
      output += `  ${icon} ${s.name} - ${s.reason}
`;
    }
  }
  return output;
}
export {
  analyzeContext,
  formatSuggestions,
  generateSuggestions,
  recordOutcome
};
