// src/subagent-stop-continuity.ts
import * as fs5 from "fs";
import * as path5 from "path";

// src/agent-tracker.ts
import * as fs from "fs";
import * as path from "path";
var STATE_VERSION = "1.0.0";
function getStatePath(projectDir) {
  return path.join(projectDir, ".claude", "cache", "agents", "active-agents.json");
}
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
function saveAgentState(projectDir, state) {
  const statePath = getStatePath(projectDir);
  ensureDir(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function completeAgent(projectDir, agentId, success = true) {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find((a) => a.id === agentId);
  if (agent) {
    agent.status = success ? "completed" : "failed";
    agent.completed_at = (/* @__PURE__ */ new Date()).toISOString();
    agent.duration_ms = new Date(agent.completed_at).getTime() - new Date(agent.started_at).getTime();
    saveAgentState(projectDir, state);
    return agent;
  }
  return null;
}
function getActiveAgents(projectDir) {
  const state = loadAgentState(projectDir);
  return state.agents.filter((a) => a.status === "running");
}
function cleanupOldAgents(projectDir) {
  const state = loadAgentState(projectDir);
  const running = state.agents.filter((a) => a.status === "running");
  const completed = state.agents.filter((a) => a.status !== "running").sort((a, b) => {
    const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
    const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
    return timeB - timeA;
  }).slice(0, 10);
  state.agents = [...running, ...completed];
  saveAgentState(projectDir, state);
}
function formatAgentSummary(agent) {
  const tokensK = (agent.tokens_used / 1e3).toFixed(1);
  const duration = agent.duration_ms ? `${Math.floor(agent.duration_ms / 1e3)}s` : "running";
  return `${agent.name}: ${agent.tool_uses} tools \xB7 ${tokensK}k tokens \xB7 ${duration}`;
}

// src/notifications.ts
import { execSync, exec } from "child_process";
import * as fs2 from "fs";
import * as path2 from "path";
var DEFAULT_CONFIG = {
  enabled: true,
  soundEnabled: true,
  agentComplete: true,
  contextWarning: true,
  handoffReminder: true
};
function loadConfig(projectDir) {
  const configPath = path2.join(projectDir, ".claude", "cache", "notification-config.json");
  if (fs2.existsSync(configPath)) {
    try {
      const content = fs2.readFileSync(configPath, "utf-8");
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
function notifyAgentComplete(projectDir, agentName, success, metrics) {
  let message = success ? "Completed successfully" : "Finished with issues";
  if (metrics) {
    message += ` | ${metrics.toolUses} tools \xB7 ${metrics.tokensK}k tokens \xB7 ${metrics.durationS}s`;
  }
  notify(projectDir, {
    title: `\u{1F916} Agent: ${agentName}`,
    message,
    icon: success ? "success" : "warning",
    sound: true
  });
}

// src/smart-suggestions.ts
import * as fs3 from "fs";
import * as path3 from "path";
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
function recordOutcome(projectDir, agent, outcome, context) {
  const historyPath = path3.join(projectDir, ".claude", "cache", "suggestion-history.json");
  const cacheDir = path3.dirname(historyPath);
  if (!fs3.existsSync(cacheDir)) {
    fs3.mkdirSync(cacheDir, { recursive: true });
  }
  const history = loadHistory(projectDir);
  history.push({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    agent,
    outcome,
    context: context.slice(0, 200)
  });
  const trimmed = history.slice(-100);
  fs3.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2));
}

// src/learning-engine.ts
import * as fs4 from "fs";
import * as path4 from "path";
var LEARNINGS_FILE = "learnings.json";
var PATTERNS_FILE = "patterns.json";
function getLearningsPath(projectDir) {
  return path4.join(projectDir, ".claude", "cache", LEARNINGS_FILE);
}
function getPatternsPath(projectDir) {
  return path4.join(projectDir, ".claude", "cache", PATTERNS_FILE);
}
function loadLearnings(projectDir) {
  const filePath = getLearningsPath(projectDir);
  if (fs4.existsSync(filePath)) {
    try {
      return JSON.parse(fs4.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function saveLearnings(projectDir, learnings) {
  const filePath = getLearningsPath(projectDir);
  const cacheDir = path4.dirname(filePath);
  if (!fs4.existsSync(cacheDir)) {
    fs4.mkdirSync(cacheDir, { recursive: true });
  }
  fs4.writeFileSync(filePath, JSON.stringify(learnings, null, 2));
}
function loadPatterns(projectDir) {
  const filePath = getPatternsPath(projectDir);
  if (fs4.existsSync(filePath)) {
    try {
      return JSON.parse(fs4.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function savePatterns(projectDir, patterns) {
  const filePath = getPatternsPath(projectDir);
  const cacheDir = path4.dirname(filePath);
  if (!fs4.existsSync(cacheDir)) {
    fs4.mkdirSync(cacheDir, { recursive: true });
  }
  fs4.writeFileSync(filePath, JSON.stringify(patterns, null, 2));
}
function addLearning(projectDir, type, context, outcome, lesson, agent) {
  const learnings = loadLearnings(projectDir);
  const entry = {
    id: `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type,
    context: context.slice(0, 500),
    agent,
    outcome,
    lesson,
    weight: outcome === "success" ? 1 : outcome === "partial" ? 0.5 : 0.2,
    uses: 0
  };
  learnings.push(entry);
  const trimmed = learnings.slice(-200);
  saveLearnings(projectDir, trimmed);
  return entry;
}
function updatePattern(projectDir, keywords, fileTypes, agentUsed, success) {
  const patterns = loadPatterns(projectDir);
  const existing = patterns.find(
    (p) => p.agentUsed === agentUsed && arraysOverlap(p.keywords, keywords)
  );
  if (existing) {
    const newSampleSize = existing.sampleSize + 1;
    const successValue = success ? 1 : 0;
    existing.successRate = (existing.successRate * existing.sampleSize + successValue) / newSampleSize;
    existing.sampleSize = newSampleSize;
    for (const kw of keywords) {
      if (!existing.keywords.includes(kw)) {
        existing.keywords.push(kw);
      }
    }
  } else {
    patterns.push({
      keywords,
      fileTypes,
      agentUsed,
      successRate: success ? 1 : 0,
      sampleSize: 1
    });
  }
  savePatterns(projectDir, patterns);
}
function arraysOverlap(a, b) {
  return a.some((x) => b.includes(x));
}
function autoExtractLearning(projectDir, agent, task, outcome, keyDecisions) {
  const keywords = task.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
  updatePattern(projectDir, keywords, [], agent, outcome === "success");
  for (const decision of keyDecisions.slice(0, 3)) {
    addLearning(
      projectDir,
      "approach",
      task,
      outcome,
      decision,
      agent
    );
  }
}

// src/subagent-stop-continuity.ts
async function main() {
  const input = JSON.parse(await readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (input.stop_hook_active) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  try {
    const agentInfo = parseTranscript(input.transcript_path);
    if (!agentInfo.agentName) {
      console.log(JSON.stringify({ result: "continue" }));
      return;
    }
    let metricsMessage = "";
    const activeAgents = getActiveAgents(projectDir);
    const matchingAgent = activeAgents.filter((a) => a.name === agentInfo.agentName).sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
    if (matchingAgent) {
      const completed = completeAgent(projectDir, matchingAgent.id, true);
      if (completed) {
        metricsMessage = ` | Metrics: ${formatAgentSummary(completed)}`;
        console.error(`[AgentTracker] Completed: ${completed.name} - ${formatAgentSummary(completed)}`);
        notifyAgentComplete(projectDir, completed.name, true, {
          toolUses: completed.tool_uses,
          tokensK: Math.round(completed.tokens_used / 1e3),
          durationS: Math.round((Date.now() - new Date(completed.started_at).getTime()) / 1e3)
        });
        recordOutcome(projectDir, completed.name, "success", matchingAgent.task || "");
        autoExtractLearning(
          projectDir,
          completed.name,
          matchingAgent.task || "",
          "success",
          []
          // Key decisions could be extracted from transcript
        );
      }
    }
    cleanupOldAgents(projectDir);
    const outputPath = path5.join(
      projectDir,
      ".claude",
      "cache",
      "agents",
      agentInfo.agentName,
      "latest-output.md"
    );
    let outputSummary = "";
    if (fs5.existsSync(outputPath)) {
      const content = fs5.readFileSync(outputPath, "utf-8");
      const summaryMatch = content.match(/## Executive Summary\n([\s\S]*?)(?=\n##|$)/);
      const goalMatch = content.match(/## Goal\n([\s\S]*?)(?=\n##|$)/);
      const symptomMatch = content.match(/## Symptom\n([\s\S]*?)(?=\n##|$)/);
      outputSummary = summaryMatch?.[1]?.trim() || goalMatch?.[1]?.trim() || symptomMatch?.[1]?.trim() || content.slice(0, 300).trim();
    }
    writeAgentLog(projectDir, agentInfo, outputPath);
    appendToLedger(projectDir, agentInfo, outputSummary);
    const message = `[SubagentStop] ${agentInfo.agentName} completed${metricsMessage}. Report: .claude/cache/agents/${agentInfo.agentName}/latest-output.md`;
    console.log(JSON.stringify({ result: "continue", message }));
  } catch (err) {
    console.log(JSON.stringify({ result: "continue" }));
  }
}
function parseTranscript(transcriptPath) {
  let agentName = null;
  let task = "";
  let agentId = null;
  try {
    if (!fs5.existsSync(transcriptPath)) {
      return { agentName: null, task: "", agentId: null };
    }
    const content = fs5.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.tool_name === "Task" && entry.tool_input) {
          const subagentType = entry.tool_input.subagent_type;
          const prompt = entry.tool_input.prompt;
          if ([
            "research-agent",
            "plan-agent",
            "debug-agent",
            "rp-explorer",
            "codebase-analyzer",
            "codebase-locator",
            "codebase-pattern-finder",
            "explore"
          ].includes(subagentType)) {
            agentName = subagentType;
            task = prompt?.slice(0, 200) || "";
            break;
          }
        }
        if (entry.message?.content) {
          const content2 = typeof entry.message.content === "string" ? entry.message.content : entry.message.content.map((c) => c.text || "").join(" ");
          const agentMatch = content2.match(/\.claude\/agents\/([\w-]+)\.md/);
          if (agentMatch) {
            agentName = agentMatch[1];
          }
        }
      } catch {
      }
    }
  } catch {
  }
  const transcriptName = path5.basename(transcriptPath, ".jsonl");
  agentId = `${agentName}-${transcriptName.slice(-8)}`;
  return { agentName, task, agentId };
}
function writeAgentLog(projectDir, agentInfo, outputPath) {
  if (!agentInfo.agentName || !agentInfo.agentId) return;
  const logDir = path5.join(projectDir, ".claude", "cache", "agents");
  const logFile = path5.join(logDir, "agent-log.jsonl");
  if (!fs5.existsSync(logDir)) {
    fs5.mkdirSync(logDir, { recursive: true });
  }
  const logEntry = {
    agentId: agentInfo.agentId,
    type: agentInfo.agentName,
    task: agentInfo.task.slice(0, 500),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    output: outputPath.replace(projectDir, ""),
    status: "completed",
    canResume: true
  };
  fs5.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
}
function appendToLedger(projectDir, agentInfo, outputSummary) {
  if (!agentInfo.agentName) return;
  const ledgerDir = path5.join(projectDir, "thoughts", "ledgers");
  const ledgerFiles = fs5.readdirSync(ledgerDir).filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md"));
  if (ledgerFiles.length === 0) return;
  const mostRecent = ledgerFiles.sort((a, b) => {
    const statA = fs5.statSync(path5.join(ledgerDir, a));
    const statB = fs5.statSync(path5.join(ledgerDir, b));
    return statB.mtime.getTime() - statA.mtime.getTime();
  })[0];
  const ledgerPath = path5.join(ledgerDir, mostRecent);
  let content = fs5.readFileSync(ledgerPath, "utf-8");
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const agentReport = `
### ${agentInfo.agentName} (${timestamp})
- Task: ${agentInfo.task.slice(0, 100)}${agentInfo.task.length > 100 ? "..." : ""}
- Summary: ${outputSummary.slice(0, 200)}${outputSummary.length > 200 ? "..." : ""}
- Output: \`.claude/cache/agents/${agentInfo.agentName}/latest-output.md\`
`;
  const agentReportsMatch = content.match(/## Agent Reports\n/);
  if (agentReportsMatch) {
    const insertPos = content.indexOf("## Agent Reports\n") + "## Agent Reports\n".length;
    content = content.slice(0, insertPos) + agentReport + content.slice(insertPos);
  } else {
    const archMatch = content.indexOf("## Architecture Summary");
    const hooksMatch = content.indexOf("## Hooks Summary");
    const insertBefore = archMatch > 0 ? archMatch : hooksMatch > 0 ? hooksMatch : content.length;
    content = content.slice(0, insertBefore) + "\n## Agent Reports\n" + agentReport + "\n" + content.slice(insertBefore);
  }
  fs5.writeFileSync(ledgerPath, content);
}
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}
main().catch(console.error);
