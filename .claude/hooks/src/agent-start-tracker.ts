/**
 * Agent Start Tracker - PreToolUse hook for Task tool
 * 
 * Detects when an agent is spawned and registers it in the tracker.
 * This enables real-time metrics display in StatusLine.
 */

import * as fs from 'fs';
import * as path from 'path';
import { startAgent, recordToolUse, getActiveAgents } from './agent-tracker.js';

interface PreToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: {
    prompt?: string;
    subagent_type?: string;
    description?: string;
    [key: string]: unknown;
  };
}

interface HookOutput {
  decision?: 'approve' | 'block';
  reason?: string;
  message?: string;
}

// Known agent types from the project
const KNOWN_AGENTS = [
  'research-agent',
  'plan-agent',
  'debug-agent',
  'rp-explorer',
  'codebase-analyzer',
  'codebase-locator',
  'codebase-pattern-finder',
  'explore',
  'validate-agent',
  'review-agent',
  'onboard',
  'session-analyst',
  'context-query-agent',
  'braintrust-analyst',
  'repo-research-analyst'
];

async function main() {
  const input: PreToolUseInput = JSON.parse(await readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  
  // Only track Task tool (agent spawning)
  if (input.tool_name !== 'Task') {
    // For other tools, check if there's an active agent and record tool use
    const activeAgents = getActiveAgents(projectDir);
    if (activeAgents.length > 0) {
      // Record tool use for the most recent active agent
      // Note: This is imperfect - ideally we'd have agent context from the tool call
      const lastAgent = activeAgents[activeAgents.length - 1];
      recordToolUse(projectDir, lastAgent.id, input.tool_name, 0);
    }
    
    console.log(JSON.stringify({ decision: 'approve' }));
    return;
  }
  
  // Extract agent info from Task tool input
  const subagentType = input.tool_input.subagent_type as string;
  const prompt = input.tool_input.prompt as string || '';
  const description = input.tool_input.description as string || '';
  
  // Check if it's a known agent type
  let agentName = subagentType;
  if (!agentName || !KNOWN_AGENTS.includes(agentName)) {
    // Try to infer from prompt or description
    for (const known of KNOWN_AGENTS) {
      if (prompt.toLowerCase().includes(known) || description.toLowerCase().includes(known)) {
        agentName = known;
        break;
      }
    }
  }
  
  // Generate unique agent ID
  const timestamp = Date.now();
  const agentId = `${agentName || 'task'}-${input.session_id.slice(-8)}-${timestamp}`;
  
  // Register the agent
  if (agentName) {
    const agent = startAgent(
      projectDir,
      agentId,
      agentName,
      prompt || description || 'No task description'
    );
    
    // Log to stderr for visibility
    console.error(`[AgentTracker] Started: ${agent.name} (${agent.id})`);
  }
  
  // Always approve Task tool
  const output: HookOutput = { decision: 'approve' };
  console.log(JSON.stringify(output));
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

main().catch(err => {
  console.error('Error in agent-start-tracker:', err);
  // Don't block on errors
  console.log(JSON.stringify({ decision: 'approve' }));
});
