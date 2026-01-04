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
function getActiveAgents(projectDir) {
  const state = loadAgentState(projectDir);
  return state.agents.filter((a) => a.status === "running");
}

// src/agent-start-tracker.ts
var KNOWN_AGENTS = [
  "research-agent",
  "plan-agent",
  "debug-agent",
  "rp-explorer",
  "codebase-analyzer",
  "codebase-locator",
  "codebase-pattern-finder",
  "explore",
  "validate-agent",
  "review-agent",
  "onboard",
  "session-analyst",
  "context-query-agent",
  "braintrust-analyst",
  "repo-research-analyst"
];
async function main() {
  const input = JSON.parse(await readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (input.tool_name !== "Task") {
    const activeAgents = getActiveAgents(projectDir);
    if (activeAgents.length > 0) {
      const lastAgent = activeAgents[activeAgents.length - 1];
      recordToolUse(projectDir, lastAgent.id, input.tool_name, 0);
    }
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }
  const subagentType = input.tool_input.subagent_type;
  const prompt = input.tool_input.prompt || "";
  const description = input.tool_input.description || "";
  let agentName = subagentType;
  if (!agentName || !KNOWN_AGENTS.includes(agentName)) {
    for (const known of KNOWN_AGENTS) {
      if (prompt.toLowerCase().includes(known) || description.toLowerCase().includes(known)) {
        agentName = known;
        break;
      }
    }
  }
  const timestamp = Date.now();
  const agentId = `${agentName || "task"}-${input.session_id.slice(-8)}-${timestamp}`;
  if (agentName) {
    const agent = startAgent(
      projectDir,
      agentId,
      agentName,
      prompt || description || "No task description"
    );
    console.error(`[AgentTracker] Started: ${agent.name} (${agent.id})`);
  }
  const output = { decision: "approve" };
  console.log(JSON.stringify(output));
}
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}
main().catch((err) => {
  console.error("Error in agent-start-tracker:", err);
  console.log(JSON.stringify({ decision: "approve" }));
});
