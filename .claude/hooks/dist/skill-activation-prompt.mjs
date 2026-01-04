#!/usr/bin/env node

// src/skill-activation-prompt.ts
import { readFileSync as readFileSync5, existsSync as existsSync5 } from "fs";
import { join as join5 } from "path";

// src/auto-orchestration.ts
import * as fs2 from "fs";
import * as path2 from "path";

// src/agent-tracker.ts
import * as fs from "fs";
import * as path from "path";
var STATE_VERSION = "1.0.0";
function getStatePath(projectDir) {
  return path.join(projectDir, ".claude", "cache", "agents", "active-agents.json");
}
function loadAgentState(projectDir) {
  const statePath = getStatePath(projectDir);
  if (fs.existsSync(statePath)) {
    try {
      const content = fs.readFileSync(statePath, "utf-8");
      return JSON.parse(content);
    } catch {
    }
  }
  return {
    version: STATE_VERSION,
    session_id: process.env.CLAUDE_SESSION_ID || "unknown",
    agents: [],
    total_tool_uses: 0,
    total_tokens: 0
  };
}
function getActiveAgents(projectDir) {
  const state = loadAgentState(projectDir);
  return state.agents.filter((a) => a.status === "running");
}

// src/auto-orchestration.ts
function parseLedgerTasks(projectDir) {
  const result = { now: null, pending: [], phases: [] };
  const ledgerDirs = [
    path2.join(projectDir, "thoughts", "ledgers"),
    projectDir
  ];
  let ledgerPath = null;
  for (const dir of ledgerDirs) {
    if (fs2.existsSync(dir)) {
      const files = fs2.readdirSync(dir).filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md")).sort((a, b) => {
        const statA = fs2.statSync(path2.join(dir, a));
        const statB = fs2.statSync(path2.join(dir, b));
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
      if (files.length > 0) {
        ledgerPath = path2.join(dir, files[0]);
        break;
      }
    }
  }
  if (!ledgerPath) return result;
  const content = fs2.readFileSync(ledgerPath, "utf-8");
  const nowMatch = content.match(/- Now: ([^\n]+)/);
  if (nowMatch) {
    result.now = nowMatch[1].trim();
  }
  const nextMatches = content.matchAll(/- Next: ([^\n]+)/g);
  for (const match of nextMatches) {
    result.pending.push(match[1].trim());
  }
  const phaseMatches = content.matchAll(/(?:^|\n)\s*(?:###?\s*)?(P\d+)[:\s]+([^\n]+)/gi);
  for (const match of phaseMatches) {
    const phase = match[1].toUpperCase();
    const desc = match[2].trim();
    if (!result.phases.some((p) => p.startsWith(phase))) {
      result.phases.push(`${phase}: ${desc.slice(0, 50)}`);
    }
  }
  return result;
}
function canParallelize(tasks) {
  const sequentialKeywords = ["then", "after", "depends", "first", "before", "once"];
  for (const task of tasks) {
    const lower = task.toLowerCase();
    if (sequentialKeywords.some((kw) => lower.includes(kw))) {
      return false;
    }
  }
  return tasks.length >= 2;
}
function suggestAgentsForTasks(tasks) {
  const agents = [];
  for (const task of tasks) {
    const lower = task.toLowerCase();
    if (lower.includes("test") || lower.includes("tdd")) {
      agents.push("TDD workflow");
    } else if (lower.includes("research") || lower.includes("investigate")) {
      agents.push("research-agent");
    } else if (lower.includes("debug") || lower.includes("fix") || lower.includes("error")) {
      agents.push("debug-agent");
    } else if (lower.includes("plan") || lower.includes("design") || lower.includes("architect")) {
      agents.push("plan-agent");
    } else if (lower.includes("explore") || lower.includes("codebase") || lower.includes("understand")) {
      agents.push("rp-explorer");
    } else if (lower.includes("implement") || lower.includes("build") || lower.includes("create")) {
      agents.push("implement_plan");
    } else if (lower.includes("validate") || lower.includes("review") || lower.includes("check")) {
      agents.push("validate-agent");
    } else {
      agents.push("task-agent");
    }
  }
  return [...new Set(agents)];
}
function getOrchestrationContext(projectDir) {
  const sessionId = process.env.CLAUDE_SESSION_ID || process.env.PPID || "default";
  const contextFile = `/tmp/claude-context-pct-${sessionId}.txt`;
  let contextPct = 0;
  if (fs2.existsSync(contextFile)) {
    try {
      contextPct = parseInt(fs2.readFileSync(contextFile, "utf-8").trim(), 10);
    } catch {
      contextPct = 0;
    }
  }
  const activeAgents = getActiveAgents(projectDir);
  const activeCount = activeAgents.length;
  const ledgerTasks = parseLedgerTasks(projectDir);
  const pendingTasks = [
    ...ledgerTasks.now ? [ledgerTasks.now] : [],
    ...ledgerTasks.pending,
    ...ledgerTasks.phases
  ];
  let recommendation = "continue";
  let message = "";
  let suggestedAgents = [];
  if (contextPct >= 90) {
    recommendation = "handoff";
    message = `\u26A0\uFE0F Context at ${contextPct}% - Create handoff NOW before auto-compact!`;
  } else if (contextPct >= 75) {
    if (pendingTasks.length >= 2 && canParallelize(pendingTasks.slice(0, 3))) {
      recommendation = "parallel";
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 3));
      message = `Context at ${contextPct}% - I'll run ${suggestedAgents.length} agents in parallel to maximize efficiency before handoff`;
    } else if (pendingTasks.length > 0) {
      recommendation = "sequential";
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 1));
      message = `Context at ${contextPct}% - Running ${suggestedAgents[0]} for remaining task, then handoff`;
    } else {
      recommendation = "handoff";
      message = `Context at ${contextPct}% - No pending tasks, recommend handoff soon`;
    }
  } else if (contextPct >= 60) {
    if (activeCount > 0) {
      message = `Context at ${contextPct}% | ${activeCount} agent(s) running`;
    } else if (pendingTasks.length > 2 && canParallelize(pendingTasks.slice(0, 2))) {
      recommendation = "parallel";
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 2));
      message = `Context at ${contextPct}% - Consider running ${suggestedAgents.join(" + ")} in parallel`;
    } else {
      message = `Context at ${contextPct}% - Consider handoff at a stopping point`;
    }
  } else {
    if (activeCount > 0) {
      message = `${activeCount} agent(s) running`;
    }
  }
  return {
    contextPct,
    pendingTasks,
    activeAgents: activeCount,
    recommendation,
    message,
    suggestedAgents: suggestedAgents.length > 0 ? suggestedAgents : void 0
  };
}
function formatOrchestrationHeader(ctx) {
  if (!ctx.message) return "";
  let header = "";
  switch (ctx.recommendation) {
    case "parallel":
      header = `\u25CF Context at ${ctx.contextPct}% - I'll run ${ctx.suggestedAgents?.join(" and ")} in parallel to maximize efficiency before handoff:
`;
      break;
    case "sequential":
      header = `\u25CF Context at ${ctx.contextPct}% - Running ${ctx.suggestedAgents?.[0] || "task"} to complete pending work:
`;
      break;
    case "handoff":
      header = `\u25CF ${ctx.message}
`;
      break;
    default:
      if (ctx.activeAgents > 0) {
        header = `Running ${ctx.activeAgents} Task agent${ctx.activeAgents > 1 ? "s" : ""}...
`;
      }
  }
  return header;
}

// src/smart-suggestions.ts
import * as fs3 from "fs";
import * as path3 from "path";
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
    const ext = path3.extname(file).toLowerCase();
    if (!analysis.fileTypes.includes(ext)) {
      analysis.fileTypes.push(ext);
    }
  }
  try {
    const ledgerDirs = [
      path3.join(projectDir, "thoughts", "ledgers"),
      projectDir
    ];
    for (const dir of ledgerDirs) {
      if (fs3.existsSync(dir)) {
        const files = fs3.readdirSync(dir).filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md"));
        if (files.length > 0) {
          const ledgerPath = path3.join(dir, files[0]);
          const content = fs3.readFileSync(ledgerPath, "utf-8");
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
  const historyPath = path3.join(projectDir, ".claude", "cache", "suggestion-history.json");
  if (fs3.existsSync(historyPath)) {
    try {
      return JSON.parse(fs3.readFileSync(historyPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
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

// src/notifications.ts
import { execSync, exec } from "child_process";
import * as fs4 from "fs";
import * as path4 from "path";
var DEFAULT_CONFIG = {
  enabled: true,
  soundEnabled: true,
  agentComplete: true,
  contextWarning: true,
  handoffReminder: true
};
function loadConfig(projectDir) {
  const configPath = path4.join(projectDir, ".claude", "cache", "notification-config.json");
  if (fs4.existsSync(configPath)) {
    try {
      const content = fs4.readFileSync(configPath, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}
function isMacOS() {
  return process.platform === "darwin";
}
function sendMacOSNotification(options) {
  const { title, message, sound, subtitle } = options;
  let script = `display notification "${message.replace(/"/g, '\\"')}"`;
  script += ` with title "${title.replace(/"/g, '\\"')}"`;
  if (subtitle) {
    script += ` subtitle "${subtitle.replace(/"/g, '\\"')}"`;
  }
  if (sound) {
    script += ` sound name "Glass"`;
  }
  try {
    execSync(`osascript -e '${script}'`, { stdio: "ignore" });
  } catch {
  }
}
function playSound(soundName) {
  if (!isMacOS()) return;
  const sounds = {
    success: "Glass",
    warning: "Sosumi",
    error: "Basso",
    info: "Pop"
  };
  const sound = sounds[soundName] || "Pop";
  try {
    exec(`afplay /System/Library/Sounds/${sound}.aiff`, { stdio: "ignore" });
  } catch {
  }
}
function notify(projectDir, options) {
  const config = loadConfig(projectDir);
  if (!config.enabled) return;
  if (options.title.includes("Agent") && !config.agentComplete) return;
  if (options.title.includes("Context") && !config.contextWarning) return;
  if (options.title.includes("Handoff") && !config.handoffReminder) return;
  if (isMacOS()) {
    sendMacOSNotification({
      ...options,
      sound: config.soundEnabled && options.sound !== false
    });
  }
  if (config.soundEnabled && options.icon) {
    playSound(options.icon);
  }
}
function notifyContextWarning(projectDir, contextPct) {
  let title = "";
  let message = "";
  let icon = "warning";
  if (contextPct >= 90) {
    title = "\u26A0\uFE0F Context CRITICAL";
    message = `${contextPct}% - Create handoff NOW!`;
    icon = "error";
  } else if (contextPct >= 80) {
    title = "\u26A0\uFE0F Context Warning";
    message = `${contextPct}% - Consider handoff soon`;
  } else if (contextPct >= 70) {
    title = "\u{1F4CA} Context Update";
    message = `${contextPct}% - Approaching handoff threshold`;
  }
  if (title) {
    notify(projectDir, { title, message, icon, sound: contextPct >= 90 });
  }
}

// src/skill-activation-prompt.ts
async function main() {
  try {
    const input = readFileSync5(0, "utf-8");
    const data = JSON.parse(input);
    const prompt = data.prompt.toLowerCase();
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const homeDir = process.env.HOME || "";
    const projectRulesPath = join5(projectDir, ".claude", "skills", "skill-rules.json");
    const globalRulesPath = join5(homeDir, ".claude", "skills", "skill-rules.json");
    let rulesPath = "";
    if (existsSync5(projectRulesPath)) {
      rulesPath = projectRulesPath;
    } else if (existsSync5(globalRulesPath)) {
      rulesPath = globalRulesPath;
    } else {
      process.exit(0);
    }
    const rules = JSON.parse(readFileSync5(rulesPath, "utf-8"));
    const matchedSkills = [];
    for (const [skillName, config] of Object.entries(rules.skills)) {
      const triggers = config.promptTriggers;
      if (!triggers) {
        continue;
      }
      if (triggers.keywords) {
        const keywordMatch = triggers.keywords.some(
          (kw) => prompt.includes(kw.toLowerCase())
        );
        if (keywordMatch) {
          matchedSkills.push({ name: skillName, matchType: "keyword", config });
          continue;
        }
      }
      if (triggers.intentPatterns) {
        const intentMatch = triggers.intentPatterns.some((pattern) => {
          const regex = new RegExp(pattern, "i");
          return regex.test(prompt);
        });
        if (intentMatch) {
          matchedSkills.push({ name: skillName, matchType: "intent", config });
        }
      }
    }
    const matchedAgents = [];
    if (rules.agents) {
      for (const [agentName, config] of Object.entries(rules.agents)) {
        const triggers = config.promptTriggers;
        if (!triggers) {
          continue;
        }
        if (triggers.keywords) {
          const keywordMatch = triggers.keywords.some(
            (kw) => prompt.includes(kw.toLowerCase())
          );
          if (keywordMatch) {
            matchedAgents.push({ name: agentName, matchType: "keyword", config, isAgent: true });
            continue;
          }
        }
        if (triggers.intentPatterns) {
          const intentMatch = triggers.intentPatterns.some((pattern) => {
            const regex = new RegExp(pattern, "i");
            return regex.test(prompt);
          });
          if (intentMatch) {
            matchedAgents.push({ name: agentName, matchType: "intent", config, isAgent: true });
          }
        }
      }
    }
    const orchestrationCtx = getOrchestrationContext(projectDir);
    const orchestrationHeader = formatOrchestrationHeader(orchestrationCtx);
    if (orchestrationHeader && orchestrationCtx.recommendation !== "continue") {
      console.log(orchestrationHeader);
    }
    const smartSuggestions = generateSuggestions(
      projectDir,
      prompt,
      [],
      // Could pass recent files if available
      orchestrationCtx.contextPct
    );
    const suggestionsOutput = formatSuggestions(smartSuggestions);
    if (suggestionsOutput && matchedSkills.length === 0 && matchedAgents.length === 0) {
      console.log(suggestionsOutput);
    }
    if (orchestrationCtx.contextPct >= 70) {
      notifyContextWarning(projectDir, orchestrationCtx.contextPct);
    }
    if (matchedSkills.length > 0 || matchedAgents.length > 0) {
      let output = "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
      output += "\u{1F3AF} SKILL ACTIVATION CHECK\n";
      output += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n";
      const critical = matchedSkills.filter((s) => s.config.priority === "critical");
      const high = matchedSkills.filter((s) => s.config.priority === "high");
      const medium = matchedSkills.filter((s) => s.config.priority === "medium");
      const low = matchedSkills.filter((s) => s.config.priority === "low");
      if (critical.length > 0) {
        output += "\u26A0\uFE0F CRITICAL SKILLS (REQUIRED):\n";
        critical.forEach((s) => output += `  \u2192 ${s.name}
`);
        output += "\n";
      }
      if (high.length > 0) {
        output += "\u{1F4DA} RECOMMENDED SKILLS:\n";
        high.forEach((s) => output += `  \u2192 ${s.name}
`);
        output += "\n";
      }
      if (medium.length > 0) {
        output += "\u{1F4A1} SUGGESTED SKILLS:\n";
        medium.forEach((s) => output += `  \u2192 ${s.name}
`);
        output += "\n";
      }
      if (low.length > 0) {
        output += "\u{1F4CC} OPTIONAL SKILLS:\n";
        low.forEach((s) => output += `  \u2192 ${s.name}
`);
        output += "\n";
      }
      if (matchedAgents.length > 0) {
        output += "\u{1F916} RECOMMENDED AGENTS (token-efficient):\n";
        matchedAgents.forEach((a) => output += `  \u2192 ${a.name}
`);
        output += "\n";
      }
      if (matchedSkills.length > 0) {
        output += "ACTION: Use Skill tool BEFORE responding\n";
      }
      if (matchedAgents.length > 0) {
        output += "ACTION: Use Task tool with agent for exploration\n";
      }
      output += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
      console.log(output);
    }
    if (!orchestrationHeader || orchestrationCtx.recommendation === "continue") {
      const pct = orchestrationCtx.contextPct;
      let contextWarning = "";
      if (pct >= 90) {
        contextWarning = "\n" + "=".repeat(50) + "\n  CONTEXT CRITICAL: " + pct + "%\n  Run /create_handoff NOW before auto-compact!\n" + "=".repeat(50) + "\n";
      } else if (pct >= 80) {
        contextWarning = "\nCONTEXT WARNING: " + pct + "%\nRecommend: /create_handoff then /clear soon\n";
      } else if (pct >= 70) {
        contextWarning = "\nContext at " + pct + "%. Consider handoff when you reach a stopping point.\n";
      }
      if (contextWarning) {
        console.log(contextWarning);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("Error in skill-activation-prompt hook:", err);
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Uncaught error:", err);
  process.exit(1);
});
