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
export {
  canParallelize,
  formatOrchestrationHeader,
  getOrchestrationContext,
  parseLedgerTasks,
  suggestAgentsForTasks
};
