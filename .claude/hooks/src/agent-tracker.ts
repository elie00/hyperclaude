/**
 * Agent Tracker - Centralized agent metrics tracking
 * 
 * Tracks: active agents, tool uses, tokens consumed, duration
 * State file: .claude/cache/agents/active-agents.json
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AgentMetrics {
  id: string;
  name: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  tool_uses: number;
  tokens_used: number;
  duration_ms?: number;
  last_activity?: string;
  current_phase?: string; // e.g., "RED", "GREEN", "REFACTOR" for TDD
}

export interface AgentState {
  version: string;
  session_id: string;
  agents: AgentMetrics[];
  total_tool_uses: number;
  total_tokens: number;
}

const STATE_VERSION = '1.0.0';

function getStatePath(projectDir: string): string {
  return path.join(projectDir, '.claude', 'cache', 'agents', 'active-agents.json');
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadAgentState(projectDir: string): AgentState {
  const statePath = getStatePath(projectDir);
  
  if (fs.existsSync(statePath)) {
    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Corrupted file, start fresh
    }
  }
  
  // Return empty state
  return {
    version: STATE_VERSION,
    session_id: process.env.CLAUDE_SESSION_ID || 'unknown',
    agents: [],
    total_tool_uses: 0,
    total_tokens: 0
  };
}

export function saveAgentState(projectDir: string, state: AgentState): void {
  const statePath = getStatePath(projectDir);
  ensureDir(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Register a new agent when Task tool is invoked
 */
export function startAgent(
  projectDir: string,
  agentId: string,
  agentName: string,
  task: string
): AgentMetrics {
  const state = loadAgentState(projectDir);
  
  // Check if agent already exists (restart case)
  const existingIdx = state.agents.findIndex(a => a.id === agentId);
  
  const agent: AgentMetrics = {
    id: agentId,
    name: agentName,
    task: task.slice(0, 200),
    status: 'running',
    started_at: new Date().toISOString(),
    tool_uses: 0,
    tokens_used: 0,
    current_phase: 'INIT'
  };
  
  if (existingIdx >= 0) {
    // Update existing
    state.agents[existingIdx] = agent;
  } else {
    state.agents.push(agent);
  }
  
  saveAgentState(projectDir, state);
  return agent;
}

/**
 * Record a tool use for an agent
 */
export function recordToolUse(
  projectDir: string,
  agentId: string,
  toolName: string,
  tokensUsed: number = 0
): void {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find(a => a.id === agentId && a.status === 'running');
  
  if (agent) {
    agent.tool_uses += 1;
    agent.tokens_used += tokensUsed;
    agent.last_activity = new Date().toISOString();
    
    // Detect TDD phases from tool names
    if (toolName.toLowerCase().includes('test')) {
      if (agent.current_phase === 'INIT' || agent.current_phase === 'REFACTOR') {
        agent.current_phase = 'RED';
      }
    } else if (toolName === 'Edit' || toolName === 'Write') {
      if (agent.current_phase === 'RED') {
        agent.current_phase = 'GREEN';
      }
    } else if (toolName === 'Bash' && agent.current_phase === 'GREEN') {
      // Running tests after implementation
      agent.current_phase = 'REFACTOR';
    }
    
    state.total_tool_uses += 1;
    state.total_tokens += tokensUsed;
    
    saveAgentState(projectDir, state);
  }
}

/**
 * Update agent phase explicitly
 */
export function updateAgentPhase(
  projectDir: string,
  agentId: string,
  phase: string
): void {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find(a => a.id === agentId);
  
  if (agent) {
    agent.current_phase = phase;
    saveAgentState(projectDir, state);
  }
}

/**
 * Complete an agent (success or failure)
 */
export function completeAgent(
  projectDir: string,
  agentId: string,
  success: boolean = true
): AgentMetrics | null {
  const state = loadAgentState(projectDir);
  const agent = state.agents.find(a => a.id === agentId);
  
  if (agent) {
    agent.status = success ? 'completed' : 'failed';
    agent.completed_at = new Date().toISOString();
    agent.duration_ms = new Date(agent.completed_at).getTime() - new Date(agent.started_at).getTime();
    
    saveAgentState(projectDir, state);
    return agent;
  }
  
  return null;
}

/**
 * Get all active agents
 */
export function getActiveAgents(projectDir: string): AgentMetrics[] {
  const state = loadAgentState(projectDir);
  return state.agents.filter(a => a.status === 'running');
}

/**
 * Get agent by ID
 */
export function getAgent(projectDir: string, agentId: string): AgentMetrics | null {
  const state = loadAgentState(projectDir);
  return state.agents.find(a => a.id === agentId) || null;
}

/**
 * Clean up old completed agents (keep last 10)
 */
export function cleanupOldAgents(projectDir: string): void {
  const state = loadAgentState(projectDir);
  
  const running = state.agents.filter(a => a.status === 'running');
  const completed = state.agents
    .filter(a => a.status !== 'running')
    .sort((a, b) => {
      const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 10); // Keep last 10
  
  state.agents = [...running, ...completed];
  saveAgentState(projectDir, state);
}

/**
 * Format agent metrics for display
 */
export function formatAgentSummary(agent: AgentMetrics): string {
  const tokensK = (agent.tokens_used / 1000).toFixed(1);
  const duration = agent.duration_ms 
    ? `${Math.floor(agent.duration_ms / 1000)}s`
    : 'running';
  
  return `${agent.name}: ${agent.tool_uses} tools · ${tokensK}k tokens · ${duration}`;
}

/**
 * Get summary for StatusLine
 */
export function getStatusLineSummary(projectDir: string): string {
  const active = getActiveAgents(projectDir);
  
  if (active.length === 0) return '';
  
  const summaries = active.map(a => {
    const prefix = a.name.split('-')[0].slice(0, 2).toUpperCase();
    const tokensK = Math.floor(a.tokens_used / 1000);
    return `${prefix}:${tokensK}k`;
  });
  
  return `🤖${active.length} (${summaries.join(' ')})`;
}
