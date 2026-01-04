/**
 * Auto-Resume System
 * 
 * Automatically detects and offers to resume from the last handoff
 * when starting a new session.
 */

import * as fs from 'fs';
import * as path from 'path';

interface HandoffInfo {
  path: string;
  filename: string;
  sessionName: string;
  timestamp: Date;
  taskSummary: string;
  status: string;
  isAutoHandoff: boolean;
}

interface ResumeContext {
  hasHandoff: boolean;
  handoff: HandoffInfo | null;
  timeSinceLastSession: number; // in minutes
  suggestion: string;
}

/**
 * Find the most recent handoff across all sessions
 */
export function findLatestHandoff(projectDir: string): HandoffInfo | null {
  const handoffsRoot = path.join(projectDir, 'thoughts', 'shared', 'handoffs');
  
  if (!fs.existsSync(handoffsRoot)) {
    return null;
  }

  let latestHandoff: HandoffInfo | null = null;
  let latestTime = 0;

  // Iterate through session directories
  const sessionDirs = fs.readdirSync(handoffsRoot)
    .filter(f => fs.statSync(path.join(handoffsRoot, f)).isDirectory());

  for (const sessionDir of sessionDirs) {
    const sessionPath = path.join(handoffsRoot, sessionDir);
    const handoffFiles = fs.readdirSync(sessionPath)
      .filter(f => (f.startsWith('task-') || f.startsWith('auto-handoff-')) && f.endsWith('.md'));

    for (const file of handoffFiles) {
      const filePath = path.join(sessionPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtime.getTime() > latestTime) {
        latestTime = stat.mtime.getTime();
        
        // Parse handoff content
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Extract task summary
        let taskSummary = '';
        const summaryMatch = content.match(/## (?:What Was Done|In Progress|Task Summary)\n([\s\S]*?)(?=\n## |$)/);
        if (summaryMatch) {
          taskSummary = summaryMatch[1].trim().split('\n')[0].slice(0, 100);
        }

        // Extract status
        let status = 'unknown';
        const statusMatch = content.match(/status:\s*(success|partial|blocked|auto-handoff)/i);
        if (statusMatch) {
          status = statusMatch[1].toLowerCase();
        }

        latestHandoff = {
          path: filePath,
          filename: file,
          sessionName: sessionDir,
          timestamp: stat.mtime,
          taskSummary,
          status,
          isAutoHandoff: file.startsWith('auto-handoff-')
        };
      }
    }
  }

  return latestHandoff;
}

/**
 * Get resume context for session start
 */
export function getResumeContext(projectDir: string): ResumeContext {
  const latestHandoff = findLatestHandoff(projectDir);
  
  if (!latestHandoff) {
    return {
      hasHandoff: false,
      handoff: null,
      timeSinceLastSession: 0,
      suggestion: ''
    };
  }

  const now = new Date();
  const timeSinceLastSession = Math.round(
    (now.getTime() - latestHandoff.timestamp.getTime()) / (1000 * 60)
  );

  // Generate suggestion based on time and status
  let suggestion = '';
  
  if (timeSinceLastSession < 60) {
    // Less than 1 hour ago
    suggestion = `🔄 Resume recent work? Last session ended ${timeSinceLastSession}min ago`;
    if (latestHandoff.taskSummary) {
      suggestion += `\n   Task: ${latestHandoff.taskSummary}`;
    }
    suggestion += '\n   Say "resume" or "/resume_handoff" to continue';
  } else if (timeSinceLastSession < 24 * 60) {
    // Less than 24 hours ago
    const hours = Math.round(timeSinceLastSession / 60);
    suggestion = `📋 Handoff available from ${hours}h ago`;
    if (latestHandoff.taskSummary) {
      suggestion += `: ${latestHandoff.taskSummary.slice(0, 60)}...`;
    }
    suggestion += '\n   Say "resume from handoff" to continue';
  } else {
    // More than 24 hours ago
    const days = Math.round(timeSinceLastSession / (24 * 60));
    suggestion = `📁 Previous handoff available (${days} days old)`;
    suggestion += '\n   Say "resume from handoff" if relevant';
  }

  return {
    hasHandoff: true,
    handoff: latestHandoff,
    timeSinceLastSession,
    suggestion
  };
}

/**
 * Format auto-resume prompt for session start
 */
export function formatAutoResumePrompt(ctx: ResumeContext): string {
  if (!ctx.hasHandoff || !ctx.suggestion) {
    return '';
  }

  let output = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += ctx.suggestion;
  output += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return output;
}

/**
 * Check if session was interrupted (auto-handoff exists)
 */
export function wasSessionInterrupted(projectDir: string): boolean {
  const latest = findLatestHandoff(projectDir);
  return latest !== null && latest.isAutoHandoff;
}

export { HandoffInfo, ResumeContext };
