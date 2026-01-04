/**
 * Learning Engine
 * 
 * Learns from past session outcomes to improve future suggestions.
 * Tracks patterns, successful approaches, and common pitfalls.
 */

import * as fs from 'fs';
import * as path from 'path';

interface LearningEntry {
  id: string;
  timestamp: string;
  type: 'pattern' | 'approach' | 'pitfall' | 'optimization';
  context: string;
  agent?: string;
  outcome: 'success' | 'partial' | 'failed';
  lesson: string;
  weight: number; // Higher = more important
  uses: number;   // How many times this learning was applied
}

interface ContextPattern {
  keywords: string[];
  fileTypes: string[];
  agentUsed: string;
  successRate: number;
  sampleSize: number;
}

const LEARNINGS_FILE = 'learnings.json';
const PATTERNS_FILE = 'patterns.json';

/**
 * Get learning storage path
 */
function getLearningsPath(projectDir: string): string {
  return path.join(projectDir, '.claude', 'cache', LEARNINGS_FILE);
}

/**
 * Get patterns storage path
 */
function getPatternsPath(projectDir: string): string {
  return path.join(projectDir, '.claude', 'cache', PATTERNS_FILE);
}

/**
 * Load all learnings
 */
export function loadLearnings(projectDir: string): LearningEntry[] {
  const filePath = getLearningsPath(projectDir);
  
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return [];
    }
  }
  
  return [];
}

/**
 * Save learnings
 */
function saveLearnings(projectDir: string, learnings: LearningEntry[]): void {
  const filePath = getLearningsPath(projectDir);
  const cacheDir = path.dirname(filePath);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(learnings, null, 2));
}

/**
 * Load context patterns
 */
export function loadPatterns(projectDir: string): ContextPattern[] {
  const filePath = getPatternsPath(projectDir);
  
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return [];
    }
  }
  
  return [];
}

/**
 * Save patterns
 */
function savePatterns(projectDir: string, patterns: ContextPattern[]): void {
  const filePath = getPatternsPath(projectDir);
  const cacheDir = path.dirname(filePath);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(patterns, null, 2));
}

/**
 * Add a new learning
 */
export function addLearning(
  projectDir: string,
  type: LearningEntry['type'],
  context: string,
  outcome: LearningEntry['outcome'],
  lesson: string,
  agent?: string
): LearningEntry {
  const learnings = loadLearnings(projectDir);
  
  const entry: LearningEntry = {
    id: `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    context: context.slice(0, 500),
    agent,
    outcome,
    lesson,
    weight: outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.2,
    uses: 0
  };
  
  learnings.push(entry);
  
  // Keep last 200 learnings
  const trimmed = learnings.slice(-200);
  saveLearnings(projectDir, trimmed);
  
  return entry;
}

/**
 * Update pattern from outcome
 */
export function updatePattern(
  projectDir: string,
  keywords: string[],
  fileTypes: string[],
  agentUsed: string,
  success: boolean
): void {
  const patterns = loadPatterns(projectDir);
  
  // Find existing pattern or create new one
  const existing = patterns.find(p => 
    p.agentUsed === agentUsed &&
    arraysOverlap(p.keywords, keywords)
  );
  
  if (existing) {
    // Update existing pattern
    const newSampleSize = existing.sampleSize + 1;
    const successValue = success ? 1 : 0;
    existing.successRate = (
      (existing.successRate * existing.sampleSize + successValue) / newSampleSize
    );
    existing.sampleSize = newSampleSize;
    
    // Merge keywords
    for (const kw of keywords) {
      if (!existing.keywords.includes(kw)) {
        existing.keywords.push(kw);
      }
    }
  } else {
    // Create new pattern
    patterns.push({
      keywords,
      fileTypes,
      agentUsed,
      successRate: success ? 1.0 : 0.0,
      sampleSize: 1
    });
  }
  
  savePatterns(projectDir, patterns);
}

/**
 * Check if two arrays have overlapping elements
 */
function arraysOverlap(a: string[], b: string[]): boolean {
  return a.some(x => b.includes(x));
}

/**
 * Get best agent recommendation based on context
 */
export function recommendAgent(
  projectDir: string,
  prompt: string,
  fileTypes: string[] = []
): { agent: string; confidence: number; reason: string } | null {
  const patterns = loadPatterns(projectDir);
  const learnings = loadLearnings(projectDir);
  
  if (patterns.length === 0) {
    return null;
  }
  
  // Extract keywords from prompt
  const promptKeywords = prompt.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
  
  // Score each pattern
  let bestMatch: { agent: string; score: number; pattern: ContextPattern } | null = null;
  
  for (const pattern of patterns) {
    // Skip patterns with low sample size
    if (pattern.sampleSize < 2) continue;
    
    // Calculate keyword match score
    const keywordMatches = pattern.keywords.filter(k => 
      promptKeywords.some(pk => pk.includes(k) || k.includes(pk))
    ).length;
    
    if (keywordMatches === 0) continue;
    
    // Calculate overall score
    const keywordScore = keywordMatches / pattern.keywords.length;
    const successScore = pattern.successRate;
    const sampleWeight = Math.min(pattern.sampleSize / 10, 1);
    
    const totalScore = keywordScore * 0.4 + successScore * 0.4 + sampleWeight * 0.2;
    
    if (!bestMatch || totalScore > bestMatch.score) {
      bestMatch = { agent: pattern.agentUsed, score: totalScore, pattern };
    }
  }
  
  if (!bestMatch || bestMatch.score < 0.3) {
    return null;
  }
  
  // Check for relevant learnings
  const relevantLearnings = learnings.filter(l => 
    l.agent === bestMatch!.agent &&
    l.outcome === 'success' &&
    l.weight > 0.5
  );
  
  const confidence = bestMatch.score >= 0.7 ? 'high' : bestMatch.score >= 0.5 ? 'medium' : 'low';
  const reason = relevantLearnings.length > 0
    ? `Based on ${relevantLearnings.length} successful past uses`
    : `${Math.round(bestMatch.pattern.successRate * 100)}% success rate with similar tasks`;
  
  return {
    agent: bestMatch.agent,
    confidence: bestMatch.score,
    reason
  };
}

/**
 * Get top learnings for display
 */
export function getTopLearnings(
  projectDir: string,
  limit: number = 5
): LearningEntry[] {
  const learnings = loadLearnings(projectDir);
  
  // Sort by weight and recency
  return learnings
    .sort((a, b) => {
      const weightDiff = b.weight - a.weight;
      if (Math.abs(weightDiff) > 0.2) return weightDiff;
      
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, limit);
}

/**
 * Format learnings for display
 */
export function formatLearnings(learnings: LearningEntry[]): string {
  if (learnings.length === 0) {
    return '📚 No learnings recorded yet.';
  }
  
  let output = '📚 TOP LEARNINGS\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  
  for (const l of learnings) {
    const icon = l.outcome === 'success' ? '✅' : l.outcome === 'partial' ? '⚠️' : '❌';
    const agentInfo = l.agent ? ` [${l.agent}]` : '';
    output += `${icon}${agentInfo} ${l.lesson.slice(0, 80)}\n`;
  }
  
  return output;
}

/**
 * Auto-extract learning from session outcome
 */
export function autoExtractLearning(
  projectDir: string,
  agent: string,
  task: string,
  outcome: 'success' | 'partial' | 'failed',
  keyDecisions: string[]
): void {
  // Extract keywords from task
  const keywords = task.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 5);
  
  // Update pattern
  updatePattern(projectDir, keywords, [], agent, outcome === 'success');
  
  // Add learnings from key decisions
  for (const decision of keyDecisions.slice(0, 3)) {
    addLearning(
      projectDir,
      'approach',
      task,
      outcome,
      decision,
      agent
    );
  }
}

export { LearningEntry, ContextPattern };
