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
function startAgent(projectDir, agentId, agentName, task) {
  const state = loadAgentState(projectDir);
  const existingIdx = state.agents.findIndex((a) => a.id === agentId);
  const agent = {
    id: agentId,
    name: agentName,
    task: task.slice(0, 200),
    status: "running",
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    tool_uses: 0,
    tokens_used: 0,
    current_phase: "INIT"
  };
  if (existingIdx >= 0) {
    state.agents[existingIdx] = agent;
  } else {
    state.agents.push(agent);
  }
  saveAgentState(projectDir, state);
  return agent;
}
function recordToolUse(projectDir, agentId, toolName, tokensUsed = 0) {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find((a) => a.id === agentId && a.status === "running");
  if (agent) {
    agent.tool_uses += 1;
    agent.tokens_used += tokensUsed;
    agent.last_activity = (/* @__PURE__ */ new Date()).toISOString();
    if (toolName.toLowerCase().includes("test")) {
      if (agent.current_phase === "INIT" || agent.current_phase === "REFACTOR") {
        agent.current_phase = "RED";
      }
    } else if (toolName === "Edit" || toolName === "Write") {
      if (agent.current_phase === "RED") {
        agent.current_phase = "GREEN";
      }
    } else if (toolName === "Bash" && agent.current_phase === "GREEN") {
      agent.current_phase = "REFACTOR";
    }
    state.total_tool_uses += 1;
    state.total_tokens += tokensUsed;
    saveAgentState(projectDir, state);
  }
}
function updateAgentPhase(projectDir, agentId, phase) {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find((a) => a.id === agentId);
  if (agent) {
    agent.current_phase = phase;
    saveAgentState(projectDir, state);
  }
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
function getAgent(projectDir, agentId) {
  const state = loadAgentState(projectDir);
  return state.agents.find((a) => a.id === agentId) || null;
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
function getStatusLineSummary(projectDir) {
  const active = getActiveAgents(projectDir);
  if (active.length === 0) return "";
  const summaries = active.map((a) => {
    const prefix = a.name.split("-")[0].slice(0, 2).toUpperCase();
    const tokensK = Math.floor(a.tokens_used / 1e3);
    return `${prefix}:${tokensK}k`;
  });
  return `\u{1F916}${active.length} (${summaries.join(" ")})`;
}
export {
  cleanupOldAgents,
  completeAgent,
  formatAgentSummary,
  getActiveAgents,
  getAgent,
  getStatusLineSummary,
  loadAgentState,
  recordToolUse,
  saveAgentState,
  startAgent,
  updateAgentPhase
};
