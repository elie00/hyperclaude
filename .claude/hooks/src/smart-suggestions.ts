/**
 * Smart Suggestions Engine
 * 
 * Analyzes context and history to proactively suggest relevant agents/skills.
 * Goes beyond keyword matching - uses patterns, file types, and past outcomes.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Suggestion {
  type: 'agent' | 'skill' | 'action';
  name: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  priority: number;
}

interface ContextAnalysis {
  fileTypes: string[];
  recentTools: string[];
  ledgerPhase: string | null;
  errorDetected: boolean;
  testContext: boolean;
  researchContext: boolean;
  implementContext: boolean;
  debugContext: boolean;
}

interface HistoryEntry {
  timestamp: string;
  agent: string;
  outcome: 'success' | 'partial' | 'failed';
  context: string;
}

// Agent patterns - what signals suggest which agent
const AGENT_PATTERNS: Record<string, {
  keywords: string[];
  filePatterns: RegExp[];
  contextSignals: string[];
  description: string;
}> = {
  'debug-agent': {
    keywords: ['error', 'bug', 'fail', 'crash', 'broken', 'fix', 'issue', 'wrong', 'not working'],
    filePatterns: [/\.log$/, /error/i, /debug/i],
    contextSignals: ['errorDetected', 'testFailed'],
    description: 'Debug and fix issues'
  },
  'research-agent': {
    keywords: ['how to', 'best practice', 'example', 'learn', 'understand', 'what is', 'documentation'],
    filePatterns: [/README/, /\.md$/],
    contextSignals: ['researchContext', 'newLibrary'],
    description: 'Research and gather information'
  },
  'plan-agent': {
    keywords: ['plan', 'design', 'architect', 'structure', 'approach', 'strategy', 'implement'],
    filePatterns: [/\.md$/, /plan/i, /design/i],
    contextSignals: ['implementContext', 'newFeature'],
    description: 'Create implementation plans'
  },
  'rp-explorer': {
    keywords: ['explore', 'codebase', 'understand', 'navigate', 'find', 'where is', 'how does'],
    filePatterns: [],
    contextSignals: ['largeCodebase', 'unfamiliarCode'],
    description: 'Explore codebase efficiently'
  },
  'validate-agent': {
    keywords: ['check', 'verify', 'validate', 'review', 'test', 'correct', 'ensure'],
    filePatterns: [/test/, /spec/],
    contextSignals: ['testContext', 'preCommit'],
    description: 'Validate implementation against requirements'
  },
  'codebase-analyzer': {
    keywords: ['analyze', 'trace', 'flow', 'dependency', 'deep dive', 'how does X work'],
    filePatterns: [],
    contextSignals: ['complexCode', 'architectureQuestion'],
    description: 'Deep analysis of code patterns'
  }
};

// Skill patterns
const SKILL_PATTERNS: Record<string, {
  keywords: string[];
  contextSignals: string[];
}> = {
  'tdd-workflow': {
    keywords: ['test', 'tdd', 'red green', 'failing test'],
    contextSignals: ['testContext', 'implementContext']
  },
  'commit': {
    keywords: ['commit', 'save', 'push', 'git'],
    contextSignals: ['changesReady']
  },
  'create_handoff': {
    keywords: ['done', 'finish', 'handoff', 'end session', 'wrap up'],
    contextSignals: ['highContext', 'taskComplete']
  },
  'continuity_ledger': {
    keywords: ['save state', 'update ledger', 'before clear'],
    contextSignals: ['mediumContext']
  }
};

/**
 * Analyze the current context
 */
export function analyzeContext(projectDir: string, prompt: string, recentFiles: string[] = []): ContextAnalysis {
  const analysis: ContextAnalysis = {
    fileTypes: [],
    recentTools: [],
    ledgerPhase: null,
    errorDetected: false,
    testContext: false,
    researchContext: false,
    implementContext: false,
    debugContext: false
  };

  // Analyze prompt for signals
  const lowerPrompt = prompt.toLowerCase();
  
  analysis.errorDetected = /error|fail|bug|crash|broken|exception|not working/i.test(prompt);
  analysis.testContext = /test|spec|jest|pytest|vitest/i.test(prompt);
  analysis.researchContext = /how to|what is|best practice|example|documentation/i.test(prompt);
  analysis.implementContext = /implement|create|add|build|make/i.test(prompt);
  analysis.debugContext = /debug|fix|investigate|why|wrong/i.test(prompt);

  // Analyze file types from recent files
  for (const file of recentFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!analysis.fileTypes.includes(ext)) {
      analysis.fileTypes.push(ext);
    }
  }

  // Try to get ledger phase
  try {
    const ledgerDirs = [
      path.join(projectDir, 'thoughts', 'ledgers'),
      projectDir
    ];
    
    for (const dir of ledgerDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
          .filter(f => f.startsWith('CONTINUITY_CLAUDE-') && f.endsWith('.md'));
        
        if (files.length > 0) {
          const ledgerPath = path.join(dir, files[0]);
          const content = fs.readFileSync(ledgerPath, 'utf-8');
          
          const nowMatch = content.match(/- Now: ([^\n]+)/);
          if (nowMatch) {
            analysis.ledgerPhase = nowMatch[1].trim();
          }
          break;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return analysis;
}

/**
 * Load history of past agent usage and outcomes
 */
function loadHistory(projectDir: string): HistoryEntry[] {
  const historyPath = path.join(projectDir, '.claude', 'cache', 'suggestion-history.json');
  
  if (fs.existsSync(historyPath)) {
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch {
      return [];
    }
  }
  
  return [];
}

/**
 * Save a history entry
 */
export function recordOutcome(
  projectDir: string,
  agent: string,
  outcome: 'success' | 'partial' | 'failed',
  context: string
): void {
  const historyPath = path.join(projectDir, '.claude', 'cache', 'suggestion-history.json');
  const cacheDir = path.dirname(historyPath);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const history = loadHistory(projectDir);
  
  history.push({
    timestamp: new Date().toISOString(),
    agent,
    outcome,
    context: context.slice(0, 200)
  });
  
  // Keep last 100 entries
  const trimmed = history.slice(-100);
  
  fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2));
}

/**
 * Calculate confidence boost from history
 */
function getHistoryBoost(agent: string, context: string, history: HistoryEntry[]): number {
  const relevant = history.filter(h => h.agent === agent);
  
  if (relevant.length === 0) return 0;
  
  // Calculate success rate
  const successes = relevant.filter(h => h.outcome === 'success').length;
  const rate = successes / relevant.length;
  
  // Check if similar context had success
  const similarContext = relevant.filter(h => 
    h.context.toLowerCase().includes(context.toLowerCase().slice(0, 50))
  );
  
  const contextBoost = similarContext.some(h => h.outcome === 'success') ? 0.2 : 0;
  
  return (rate * 0.3) + contextBoost;
}

/**
 * Generate smart suggestions based on context
 */
export function generateSuggestions(
  projectDir: string,
  prompt: string,
  recentFiles: string[] = [],
  contextPct: number = 0
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const context = analyzeContext(projectDir, prompt, recentFiles);
  const history = loadHistory(projectDir);
  const lowerPrompt = prompt.toLowerCase();

  // Score each agent
  for (const [agentName, patterns] of Object.entries(AGENT_PATTERNS)) {
    let score = 0;
    let reason = '';

    // Keyword matching
    for (const keyword of patterns.keywords) {
      if (lowerPrompt.includes(keyword)) {
        score += 0.3;
        reason = `Detected "${keyword}" in your request`;
        break;
      }
    }

    // Context signal matching
    for (const signal of patterns.contextSignals) {
      if (context[signal as keyof ContextAnalysis]) {
        score += 0.25;
        if (!reason) reason = `Context suggests ${patterns.description.toLowerCase()}`;
      }
    }

    // File pattern matching
    for (const pattern of patterns.filePatterns) {
      if (recentFiles.some(f => pattern.test(f))) {
        score += 0.15;
      }
    }

    // History boost
    score += getHistoryBoost(agentName, prompt, history);

    // Add suggestion if score is high enough
    if (score >= 0.3) {
      suggestions.push({
        type: 'agent',
        name: agentName,
        reason: reason || patterns.description,
        confidence: score >= 0.6 ? 'high' : score >= 0.4 ? 'medium' : 'low',
        priority: Math.round(score * 100)
      });
    }
  }

  // Score skills
  for (const [skillName, patterns] of Object.entries(SKILL_PATTERNS)) {
    let score = 0;
    let reason = '';

    for (const keyword of patterns.keywords) {
      if (lowerPrompt.includes(keyword)) {
        score += 0.4;
        reason = `Detected "${keyword}"`;
        break;
      }
    }

    // Context-based suggestions
    if (skillName === 'create_handoff' && contextPct >= 75) {
      score += 0.5;
      reason = `Context at ${contextPct}% - good time for handoff`;
    }

    if (skillName === 'continuity_ledger' && contextPct >= 60 && contextPct < 75) {
      score += 0.3;
      reason = `Context at ${contextPct}% - consider saving state`;
    }

    if (score >= 0.3) {
      suggestions.push({
        type: 'skill',
        name: skillName,
        reason,
        confidence: score >= 0.6 ? 'high' : score >= 0.4 ? 'medium' : 'low',
        priority: Math.round(score * 100)
      });
    }
  }

  // Sort by priority
  suggestions.sort((a, b) => b.priority - a.priority);

  return suggestions.slice(0, 5); // Top 5 suggestions
}

/**
 * Format suggestions for display
 */
export function formatSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) return '';

  const highConfidence = suggestions.filter(s => s.confidence === 'high');
  const mediumConfidence = suggestions.filter(s => s.confidence === 'medium');

  let output = '';

  if (highConfidence.length > 0) {
    output += '💡 SUGGESTED:\n';
    for (const s of highConfidence) {
      const icon = s.type === 'agent' ? '🤖' : '⚡';
      output += `  ${icon} ${s.name} - ${s.reason}\n`;
    }
  }

  if (mediumConfidence.length > 0 && highConfidence.length === 0) {
    output += '💭 CONSIDER:\n';
    for (const s of mediumConfidence.slice(0, 2)) {
      const icon = s.type === 'agent' ? '🤖' : '⚡';
      output += `  ${icon} ${s.name} - ${s.reason}\n`;
    }
  }

  return output;
}

export { ContextAnalysis, Suggestion, HistoryEntry };
