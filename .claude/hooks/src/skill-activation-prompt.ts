#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getOrchestrationContext, formatOrchestrationHeader } from './auto-orchestration.js';
import { generateSuggestions, formatSuggestions } from './smart-suggestions.js';
import { getResumeContext, formatAutoResumePrompt } from './auto-resume.js';
import { notifyContextWarning } from './notifications.js';

interface HookInput {
    session_id: string;
    transcript_path: string;
    cwd: string;
    permission_mode: string;
    prompt: string;
}

interface PromptTriggers {
    keywords?: string[];
    intentPatterns?: string[];
}

interface SkillRule {
    type: 'guardrail' | 'domain';
    enforcement: 'block' | 'suggest' | 'warn';
    priority: 'critical' | 'high' | 'medium' | 'low';
    promptTriggers?: PromptTriggers;
}

interface SkillRules {
    version: string;
    skills: Record<string, SkillRule>;
    agents?: Record<string, SkillRule>;
}

interface MatchedSkill {
    name: string;
    matchType: 'keyword' | 'intent';
    config: SkillRule;
    isAgent?: boolean;
}

async function main() {
    try {
        // Read input from stdin
        const input = readFileSync(0, 'utf-8');
        const data: HookInput = JSON.parse(input);
        const prompt = data.prompt.toLowerCase();

        // Load skill rules (try project first, then global)
        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const homeDir = process.env.HOME || '';
        const projectRulesPath = join(projectDir, '.claude', 'skills', 'skill-rules.json');
        const globalRulesPath = join(homeDir, '.claude', 'skills', 'skill-rules.json');

        let rulesPath = '';
        if (existsSync(projectRulesPath)) {
            rulesPath = projectRulesPath;
        } else if (existsSync(globalRulesPath)) {
            rulesPath = globalRulesPath;
        } else {
            // No rules file found, exit silently
            process.exit(0);
        }
        const rules: SkillRules = JSON.parse(readFileSync(rulesPath, 'utf-8'));

        const matchedSkills: MatchedSkill[] = [];

        // Check each skill for matches
        for (const [skillName, config] of Object.entries(rules.skills)) {
            const triggers = config.promptTriggers;
            if (!triggers) {
                continue;
            }

            // Keyword matching
            if (triggers.keywords) {
                const keywordMatch = triggers.keywords.some(kw =>
                    prompt.includes(kw.toLowerCase())
                );
                if (keywordMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'keyword', config });
                    continue;
                }
            }

            // Intent pattern matching
            if (triggers.intentPatterns) {
                const intentMatch = triggers.intentPatterns.some(pattern => {
                    const regex = new RegExp(pattern, 'i');
                    return regex.test(prompt);
                });
                if (intentMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'intent', config });
                }
            }
        }

        // Check each agent for matches
        const matchedAgents: MatchedSkill[] = [];
        if (rules.agents) {
            for (const [agentName, config] of Object.entries(rules.agents)) {
                const triggers = config.promptTriggers;
                if (!triggers) {
                    continue;
                }

                // Keyword matching
                if (triggers.keywords) {
                    const keywordMatch = triggers.keywords.some(kw =>
                        prompt.includes(kw.toLowerCase())
                    );
                    if (keywordMatch) {
                        matchedAgents.push({ name: agentName, matchType: 'keyword', config, isAgent: true });
                        continue;
                    }
                }

                // Intent pattern matching
                if (triggers.intentPatterns) {
                    const intentMatch = triggers.intentPatterns.some(pattern => {
                        const regex = new RegExp(pattern, 'i');
                        return regex.test(prompt);
                    });
                    if (intentMatch) {
                        matchedAgents.push({ name: agentName, matchType: 'intent', config, isAgent: true });
                    }
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // AUTO-ORCHESTRATION - Check context and suggest parallel agents
        // ─────────────────────────────────────────────────────────────────
        const orchestrationCtx = getOrchestrationContext(projectDir);
        const orchestrationHeader = formatOrchestrationHeader(orchestrationCtx);
        
        if (orchestrationHeader && orchestrationCtx.recommendation !== 'continue') {
            console.log(orchestrationHeader);
        }

        // ─────────────────────────────────────────────────────────────────
        // SMART SUGGESTIONS - Proactive agent/skill recommendations
        // ─────────────────────────────────────────────────────────────────
        const smartSuggestions = generateSuggestions(
            projectDir,
            prompt,
            [], // Could pass recent files if available
            orchestrationCtx.contextPct
        );
        const suggestionsOutput = formatSuggestions(smartSuggestions);
        if (suggestionsOutput && matchedSkills.length === 0 && matchedAgents.length === 0) {
            // Only show smart suggestions if no keyword matches
            console.log(suggestionsOutput);
        }

        // ─────────────────────────────────────────────────────────────────
        // NOTIFICATIONS - Send system notification for high context
        // ─────────────────────────────────────────────────────────────────
        if (orchestrationCtx.contextPct >= 70) {
            notifyContextWarning(projectDir, orchestrationCtx.contextPct);
        }

        // Generate output if matches found
        if (matchedSkills.length > 0 || matchedAgents.length > 0) {
            let output = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            output += '🎯 SKILL ACTIVATION CHECK\n';
            output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

            // Group skills by priority
            const critical = matchedSkills.filter(s => s.config.priority === 'critical');
            const high = matchedSkills.filter(s => s.config.priority === 'high');
            const medium = matchedSkills.filter(s => s.config.priority === 'medium');
            const low = matchedSkills.filter(s => s.config.priority === 'low');

            if (critical.length > 0) {
                output += '⚠️ CRITICAL SKILLS (REQUIRED):\n';
                critical.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (high.length > 0) {
                output += '📚 RECOMMENDED SKILLS:\n';
                high.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (medium.length > 0) {
                output += '💡 SUGGESTED SKILLS:\n';
                medium.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            if (low.length > 0) {
                output += '📌 OPTIONAL SKILLS:\n';
                low.forEach(s => output += `  → ${s.name}\n`);
                output += '\n';
            }

            // Add matched agents
            if (matchedAgents.length > 0) {
                output += '🤖 RECOMMENDED AGENTS (token-efficient):\n';
                matchedAgents.forEach(a => output += `  → ${a.name}\n`);
                output += '\n';
            }

            if (matchedSkills.length > 0) {
                output += 'ACTION: Use Skill tool BEFORE responding\n';
            }
            if (matchedAgents.length > 0) {
                output += 'ACTION: Use Task tool with agent for exploration\n';
            }
            output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

            console.log(output);
        }

        // Use orchestration context for tiered warnings (already computed above)
        // Only show warning if we didn't already show orchestration header
        if (!orchestrationHeader || orchestrationCtx.recommendation === 'continue') {
            const pct = orchestrationCtx.contextPct;
            let contextWarning = '';

            if (pct >= 90) {
                contextWarning = '\n' +
                    '='.repeat(50) + '\n' +
                    '  CONTEXT CRITICAL: ' + pct + '%\n' +
                    '  Run /create_handoff NOW before auto-compact!\n' +
                    '='.repeat(50) + '\n';
            } else if (pct >= 80) {
                contextWarning = '\n' +
                    'CONTEXT WARNING: ' + pct + '%\n' +
                    'Recommend: /create_handoff then /clear soon\n';
            } else if (pct >= 70) {
                contextWarning = '\nContext at ' + pct + '%. Consider handoff when you reach a stopping point.\n';
            }

            if (contextWarning) {
                console.log(contextWarning);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('Error in skill-activation-prompt hook:', err);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
});
