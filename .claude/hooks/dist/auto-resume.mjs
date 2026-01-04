// src/auto-resume.ts
import * as fs from "fs";
import * as path from "path";
function findLatestHandoff(projectDir) {
  const handoffsRoot = path.join(projectDir, "thoughts", "shared", "handoffs");
  if (!fs.existsSync(handoffsRoot)) {
    return null;
  }
  let latestHandoff = null;
  let latestTime = 0;
  const sessionDirs = fs.readdirSync(handoffsRoot).filter((f) => fs.statSync(path.join(handoffsRoot, f)).isDirectory());
  for (const sessionDir of sessionDirs) {
    const sessionPath = path.join(handoffsRoot, sessionDir);
    const handoffFiles = fs.readdirSync(sessionPath).filter((f) => (f.startsWith("task-") || f.startsWith("auto-handoff-")) && f.endsWith(".md"));
    for (const file of handoffFiles) {
      const filePath = path.join(sessionPath, file);
      const stat = fs.statSync(filePath);
      if (stat.mtime.getTime() > latestTime) {
        latestTime = stat.mtime.getTime();
        const content = fs.readFileSync(filePath, "utf-8");
        let taskSummary = "";
        const summaryMatch = content.match(/## (?:What Was Done|In Progress|Task Summary)\n([\s\S]*?)(?=\n## |$)/);
        if (summaryMatch) {
          taskSummary = summaryMatch[1].trim().split("\n")[0].slice(0, 100);
        }
        let status = "unknown";
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
          isAutoHandoff: file.startsWith("auto-handoff-")
        };
      }
    }
  }
  return latestHandoff;
}
function getResumeContext(projectDir) {
  const latestHandoff = findLatestHandoff(projectDir);
  if (!latestHandoff) {
    return {
      hasHandoff: false,
      handoff: null,
      timeSinceLastSession: 0,
      suggestion: ""
    };
  }
  const now = /* @__PURE__ */ new Date();
  const timeSinceLastSession = Math.round(
    (now.getTime() - latestHandoff.timestamp.getTime()) / (1e3 * 60)
  );
  let suggestion = "";
  if (timeSinceLastSession < 60) {
    suggestion = `\u{1F504} Resume recent work? Last session ended ${timeSinceLastSession}min ago`;
    if (latestHandoff.taskSummary) {
      suggestion += `
   Task: ${latestHandoff.taskSummary}`;
    }
    suggestion += '\n   Say "resume" or "/resume_handoff" to continue';
  } else if (timeSinceLastSession < 24 * 60) {
    const hours = Math.round(timeSinceLastSession / 60);
    suggestion = `\u{1F4CB} Handoff available from ${hours}h ago`;
    if (latestHandoff.taskSummary) {
      suggestion += `: ${latestHandoff.taskSummary.slice(0, 60)}...`;
    }
    suggestion += '\n   Say "resume from handoff" to continue';
  } else {
    const days = Math.round(timeSinceLastSession / (24 * 60));
    suggestion = `\u{1F4C1} Previous handoff available (${days} days old)`;
    suggestion += '\n   Say "resume from handoff" if relevant';
  }
  return {
    hasHandoff: true,
    handoff: latestHandoff,
    timeSinceLastSession,
    suggestion
  };
}
function formatAutoResumePrompt(ctx) {
  if (!ctx.hasHandoff || !ctx.suggestion) {
    return "";
  }
  let output = "\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
  output += ctx.suggestion;
  output += "\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
  return output;
}
function wasSessionInterrupted(projectDir) {
  const latest = findLatestHandoff(projectDir);
  return latest !== null && latest.isAutoHandoff;
}
export {
  findLatestHandoff,
  formatAutoResumePrompt,
  getResumeContext,
  wasSessionInterrupted
};
