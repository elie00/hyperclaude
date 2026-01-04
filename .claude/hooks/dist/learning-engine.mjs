// src/learning-engine.ts
import * as fs from "fs";
import * as path from "path";
var LEARNINGS_FILE = "learnings.json";
var PATTERNS_FILE = "patterns.json";
function getLearningsPath(projectDir) {
  return path.join(projectDir, ".claude", "cache", LEARNINGS_FILE);
}
function getPatternsPath(projectDir) {
  return path.join(projectDir, ".claude", "cache", PATTERNS_FILE);
}
function loadLearnings(projectDir) {
  const filePath = getLearningsPath(projectDir);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function saveLearnings(projectDir, learnings) {
  const filePath = getLearningsPath(projectDir);
  const cacheDir = path.dirname(filePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(learnings, null, 2));
}
function loadPatterns(projectDir) {
  const filePath = getPatternsPath(projectDir);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function savePatterns(projectDir, patterns) {
  const filePath = getPatternsPath(projectDir);
  const cacheDir = path.dirname(filePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(patterns, null, 2));
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
function recommendAgent(projectDir, prompt, fileTypes = []) {
  const patterns = loadPatterns(projectDir);
  const learnings = loadLearnings(projectDir);
  if (patterns.length === 0) {
    return null;
  }
  const promptKeywords = prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let bestMatch = null;
  for (const pattern of patterns) {
    if (pattern.sampleSize < 2) continue;
    const keywordMatches = pattern.keywords.filter(
      (k) => promptKeywords.some((pk) => pk.includes(k) || k.includes(pk))
    ).length;
    if (keywordMatches === 0) continue;
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
  const relevantLearnings = learnings.filter(
    (l) => l.agent === bestMatch.agent && l.outcome === "success" && l.weight > 0.5
  );
  const confidence = bestMatch.score >= 0.7 ? "high" : bestMatch.score >= 0.5 ? "medium" : "low";
  const reason = relevantLearnings.length > 0 ? `Based on ${relevantLearnings.length} successful past uses` : `${Math.round(bestMatch.pattern.successRate * 100)}% success rate with similar tasks`;
  return {
    agent: bestMatch.agent,
    confidence: bestMatch.score,
    reason
  };
}
function getTopLearnings(projectDir, limit = 5) {
  const learnings = loadLearnings(projectDir);
  return learnings.sort((a, b) => {
    const weightDiff = b.weight - a.weight;
    if (Math.abs(weightDiff) > 0.2) return weightDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  }).slice(0, limit);
}
function formatLearnings(learnings) {
  if (learnings.length === 0) {
    return "\u{1F4DA} No learnings recorded yet.";
  }
  let output = "\u{1F4DA} TOP LEARNINGS\n";
  output += "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
  for (const l of learnings) {
    const icon = l.outcome === "success" ? "\u2705" : l.outcome === "partial" ? "\u26A0\uFE0F" : "\u274C";
    const agentInfo = l.agent ? ` [${l.agent}]` : "";
    output += `${icon}${agentInfo} ${l.lesson.slice(0, 80)}
`;
  }
  return output;
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
export {
  addLearning,
  autoExtractLearning,
  formatLearnings,
  getTopLearnings,
  loadLearnings,
  loadPatterns,
  recommendAgent,
  updatePattern
};
