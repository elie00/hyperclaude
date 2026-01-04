/**
 * Auto-Orchestration - Intelligent agent spawning before handoff
 * 
 * When context reaches critical levels:
 * - Analyzes pending tasks from ledger
 * - Suggests running agents in parallel to maximize efficiency
 * - Provides decision context for the orchestrator
 */

import * as fs from 'fs';
import * as path from 'path';
import { getActiveAgents, loadAgentState } from './agent-tracker.js';

interface OrchestrationContext {
  contextPct: number;
  pendingTasks: string[];
  activeAgents: number;
  recommendation: 'parallel' | 'sequential' | 'handoff' | 'continue';
  message: string;
  suggestedAgents?: string[];
}

interface LedgerTasks {
  now: string | null;
  pending: string[];
  phases: string[];
}

/**
 * Parse ledger to extract pending tasks
 */
function parseLedgerTasks(projectDir: string): LedgerTasks {
  const result: LedgerTasks = { now: null, pending: [], phases: [] };
  
  // Find ledger file
  const ledgerDirs = [
    path.join(projectDir, 'thoughts', 'ledgers'),
    projectDir
  ];
  
  let ledgerPath: string | null = null;
  for (const dir of ledgerDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('CONTINUITY_CLAUDE-') && f.endsWith('.md'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(dir, a));
          const statB = fs.statSync(path.join(dir, b));
          return statB.mtime.getTime() - statA.mtime.getTime();
        });
      
      if (files.length > 0) {
        ledgerPath = path.join(dir, files[0]);
        break;
      }
    }
  }
  
  if (!ledgerPath) return result;
  
  const content = fs.readFileSync(ledgerPath, 'utf-8');
  
  // Extract "Now:" task
  const nowMatch = content.match(/- Now: ([^\n]+)/);
  if (nowMatch) {
    result.now = nowMatch[1].trim();
  }
  
  // Extract "Next:" tasks
  const nextMatches = content.matchAll(/- Next: ([^\n]+)/g);
  for (const match of nextMatches) {
    result.pending.push(match[1].trim());
  }
  
  // Extract phases (P1, P2, P3, etc.)
  const phaseMatches = content.matchAll(/(?:^|\n)\s*(?:###?\s*)?(P\d+)[:\s]+([^\n]+)/gi);
  for (const match of phaseMatches) {
    const phase = match[1].toUpperCase();
    const desc = match[2].trim();
    if (!result.phases.some(p => p.startsWith(phase))) {
      result.phases.push(`${phase}: ${desc.slice(0, 50)}`);
    }
  }
  
  return result;
}

/**
 * Determine if tasks can be parallelized
 */
function canParallelize(tasks: string[]): boolean {
  // Keywords that suggest sequential dependency
  const sequentialKeywords = ['then', 'after', 'depends', 'first', 'before', 'once'];
  
  // Check if any task has sequential keywords
  for (const task of tasks) {
    const lower = task.toLowerCase();
    if (sequentialKeywords.some(kw => lower.includes(kw))) {
      return false;
    }
  }
  
  return tasks.length >= 2;
}

/**
 * Map tasks to agent types
 */
function suggestAgentsForTasks(tasks: string[]): string[] {
  const agents: string[] = [];
  
  for (const task of tasks) {
    const lower = task.toLowerCase();
    
    if (lower.includes('test') || lower.includes('tdd')) {
      agents.push('TDD workflow');
    } else if (lower.includes('research') || lower.includes('investigate')) {
      agents.push('research-agent');
    } else if (lower.includes('debug') || lower.includes('fix') || lower.includes('error')) {
      agents.push('debug-agent');
    } else if (lower.includes('plan') || lower.includes('design') || lower.includes('architect')) {
      agents.push('plan-agent');
    } else if (lower.includes('explore') || lower.includes('codebase') || lower.includes('understand')) {
      agents.push('rp-explorer');
    } else if (lower.includes('implement') || lower.includes('build') || lower.includes('create')) {
      agents.push('implement_plan');
    } else if (lower.includes('validate') || lower.includes('review') || lower.includes('check')) {
      agents.push('validate-agent');
    } else {
      // Default to a generic task agent
      agents.push('task-agent');
    }
  }
  
  // Deduplicate
  return [...new Set(agents)];
}

/**
 * Main orchestration decision function
 */
export function getOrchestrationContext(projectDir: string): OrchestrationContext {
  // Read context percentage
  const sessionId = process.env.CLAUDE_SESSION_ID || process.env.PPID || 'default';
  const contextFile = `/tmp/claude-context-pct-${sessionId}.txt`;
  
  let contextPct = 0;
  if (fs.existsSync(contextFile)) {
    try {
      contextPct = parseInt(fs.readFileSync(contextFile, 'utf-8').trim(), 10);
    } catch {
      contextPct = 0;
    }
  }
  
  // Get active agents
  const activeAgents = getActiveAgents(projectDir);
  const activeCount = activeAgents.length;
  
  // Parse pending tasks from ledger
  const ledgerTasks = parseLedgerTasks(projectDir);
  const pendingTasks = [
    ...(ledgerTasks.now ? [ledgerTasks.now] : []),
    ...ledgerTasks.pending,
    ...ledgerTasks.phases
  ];
  
  // Decision logic
  let recommendation: OrchestrationContext['recommendation'] = 'continue';
  let message = '';
  let suggestedAgents: string[] = [];
  
  if (contextPct >= 90) {
    // Critical - handoff immediately
    recommendation = 'handoff';
    message = `⚠️ Context at ${contextPct}% - Create handoff NOW before auto-compact!`;
  } else if (contextPct >= 75) {
    // High context - decide based on tasks
    if (pendingTasks.length >= 2 && canParallelize(pendingTasks.slice(0, 3))) {
      recommendation = 'parallel';
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 3));
      message = `Context at ${contextPct}% - I'll run ${suggestedAgents.length} agents in parallel to maximize efficiency before handoff`;
    } else if (pendingTasks.length > 0) {
      recommendation = 'sequential';
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 1));
      message = `Context at ${contextPct}% - Running ${suggestedAgents[0]} for remaining task, then handoff`;
    } else {
      recommendation = 'handoff';
      message = `Context at ${contextPct}% - No pending tasks, recommend handoff soon`;
    }
  } else if (contextPct >= 60) {
    // Medium context - continue but warn
    if (activeCount > 0) {
      message = `Context at ${contextPct}% | ${activeCount} agent(s) running`;
    } else if (pendingTasks.length > 2 && canParallelize(pendingTasks.slice(0, 2))) {
      recommendation = 'parallel';
      suggestedAgents = suggestAgentsForTasks(pendingTasks.slice(0, 2));
      message = `Context at ${contextPct}% - Consider running ${suggestedAgents.join(' + ')} in parallel`;
    } else {
      message = `Context at ${contextPct}% - Consider handoff at a stopping point`;
    }
  } else {
    // Normal context
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
    suggestedAgents: suggestedAgents.length > 0 ? suggestedAgents : undefined
  };
}

/**
 * Format orchestration header for display
 */
export function formatOrchestrationHeader(ctx: OrchestrationContext): string {
  if (!ctx.message) return '';
  
  let header = '';
  
  switch (ctx.recommendation) {
    case 'parallel':
      header = `● Context at ${ctx.contextPct}% - I'll run ${ctx.suggestedAgents?.join(' and ')} in parallel to maximize efficiency before handoff:\n`;
      break;
    case 'sequential':
      header = `● Context at ${ctx.contextPct}% - Running ${ctx.suggestedAgents?.[0] || 'task'} to complete pending work:\n`;
      break;
    case 'handoff':
      header = `● ${ctx.message}\n`;
      break;
    default:
      if (ctx.activeAgents > 0) {
        header = `Running ${ctx.activeAgents} Task agent${ctx.activeAgents > 1 ? 's' : ''}...\n`;
      }
  }
  
  return header;
}

// Export for use in other hooks
export { parseLedgerTasks, canParallelize, suggestAgentsForTasks };
