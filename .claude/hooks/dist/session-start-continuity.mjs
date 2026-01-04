// src/session-start-continuity.ts
import * as fs2 from "fs";
import * as path2 from "path";
import { execSync } from "child_process";

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

// src/session-start-continuity.ts
function pruneLedger(ledgerPath) {
  let content = fs2.readFileSync(ledgerPath, "utf-8");
  const originalLength = content.length;
  content = content.replace(/\n### Session Ended \([^)]+\)\n- Reason: \w+\n/g, "");
  const agentReportsMatch = content.match(/## Agent Reports\n([\s\S]*?)(?=\n## |$)/);
  if (agentReportsMatch) {
    const agentReportsSection = agentReportsMatch[0];
    const reports = agentReportsSection.match(/### [^\n]+ \(\d{4}-\d{2}-\d{2}[^)]*\)[\s\S]*?(?=\n### |\n## |$)/g);
    if (reports && reports.length > 10) {
      const keptReports = reports.slice(-10);
      const newAgentReportsSection = "## Agent Reports\n" + keptReports.join("");
      content = content.replace(agentReportsSection, newAgentReportsSection);
    }
  }
  if (content.length !== originalLength) {
    fs2.writeFileSync(ledgerPath, content);
    console.error(`Pruned ledger: ${originalLength} \u2192 ${content.length} bytes`);
  }
}
function getLatestHandoff(handoffDir) {
  if (!fs2.existsSync(handoffDir)) return null;
  const handoffFiles = fs2.readdirSync(handoffDir).filter((f) => (f.startsWith("task-") || f.startsWith("auto-handoff-")) && f.endsWith(".md")).sort((a, b) => {
    const statA = fs2.statSync(path2.join(handoffDir, a));
    const statB = fs2.statSync(path2.join(handoffDir, b));
    return statB.mtime.getTime() - statA.mtime.getTime();
  });
  if (handoffFiles.length === 0) return null;
  const latestFile = handoffFiles[0];
  const content = fs2.readFileSync(path2.join(handoffDir, latestFile), "utf-8");
  const isAutoHandoff = latestFile.startsWith("auto-handoff-");
  let taskNumber;
  let status;
  let summary;
  if (isAutoHandoff) {
    const typeMatch = content.match(/type:\s*auto-handoff/i);
    status = typeMatch ? "auto-handoff" : "unknown";
    const timestampMatch = latestFile.match(/auto-handoff-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    taskNumber = timestampMatch ? timestampMatch[1] : "auto";
    const inProgressMatch = content.match(/## In Progress\n([\s\S]*?)(?=\n## |$)/);
    summary = inProgressMatch ? inProgressMatch[1].trim().split("\n").slice(0, 3).join("; ").substring(0, 150) : "Auto-handoff from pre-compact";
  } else {
    const taskMatch = latestFile.match(/task-(\d+)/);
    taskNumber = taskMatch ? taskMatch[1] : "??";
    const statusMatch = content.match(/status:\s*(success|partial|blocked)/i);
    status = statusMatch ? statusMatch[1] : "unknown";
    const summaryMatch = content.match(/## What Was Done\n([\s\S]*?)(?=\n## |$)/);
    summary = summaryMatch ? summaryMatch[1].trim().split("\n").slice(0, 2).join("; ").substring(0, 150) : "No summary available";
  }
  return {
    filename: latestFile,
    taskNumber,
    status,
    summary,
    isAutoHandoff
  };
}
function getUnmarkedHandoffs() {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const dbPath = path2.join(projectDir, ".claude", "cache", "artifact-index", "context.db");
    if (!fs2.existsSync(dbPath)) {
      return [];
    }
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT id, session_name, task_number, task_summary FROM handoffs WHERE outcome = 'UNKNOWN' ORDER BY indexed_at DESC LIMIT 5"`,
      { encoding: "utf-8", timeout: 3e3 }
    );
    if (!result.trim()) {
      return [];
    }
    return result.trim().split("\n").map((line) => {
      const [id, session_name, task_number, task_summary] = line.split("|");
      return { id, session_name, task_number: task_number || null, task_summary: task_summary || "" };
    });
  } catch (error) {
    return [];
  }
}
async function main() {
  const input = JSON.parse(await readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionType = input.source || input.type;
  const ledgerDir = path2.join(projectDir, "thoughts", "ledgers");
  if (!fs2.existsSync(ledgerDir)) {
    console.log(JSON.stringify({ result: "continue" }));
    return;
  }
  const ledgerFiles = fs2.readdirSync(ledgerDir).filter((f) => f.startsWith("CONTINUITY_CLAUDE-") && f.endsWith(".md")).sort((a, b) => {
    const statA = fs2.statSync(path2.join(ledgerDir, a));
    const statB = fs2.statSync(path2.join(ledgerDir, b));
    return statB.mtime.getTime() - statA.mtime.getTime();
  });
  let message = "";
  let additionalContext = "";
  if (ledgerFiles.length > 0) {
    const mostRecent = ledgerFiles[0];
    const ledgerPath = path2.join(ledgerDir, mostRecent);
    pruneLedger(ledgerPath);
    const ledgerContent = fs2.readFileSync(ledgerPath, "utf-8");
    const goalMatch = ledgerContent.match(/## Goal\n([\s\S]*?)(?=\n## |$)/);
    const nowMatch = ledgerContent.match(/- Now: ([^\n]+)/);
    const goalSummary = goalMatch ? goalMatch[1].trim().split("\n")[0].substring(0, 100) : "No goal found";
    const currentFocus = nowMatch ? nowMatch[1].trim() : "Unknown";
    const sessionName = mostRecent.replace("CONTINUITY_CLAUDE-", "").replace(".md", "");
    const handoffDir = path2.join(projectDir, "thoughts", "shared", "handoffs", sessionName);
    const latestHandoff = getLatestHandoff(handoffDir);
    if (sessionType === "startup") {
      let startupMsg = `\u{1F4CB} Ledger available: ${sessionName} \u2192 ${currentFocus}`;
      if (latestHandoff) {
        if (latestHandoff.isAutoHandoff) {
          startupMsg += ` | Last handoff: auto (${latestHandoff.status})`;
        } else {
          startupMsg += ` | Last handoff: task-${latestHandoff.taskNumber} (${latestHandoff.status})`;
        }
      }
      startupMsg += " (run /resume_handoff to continue)";
      const resumeCtx = getResumeContext(projectDir);
      const resumePrompt = formatAutoResumePrompt(resumeCtx);
      if (resumePrompt) {
        startupMsg += resumePrompt;
      }
      message = startupMsg;
    } else {
      console.error(`\u2713 Ledger loaded: ${sessionName} \u2192 ${currentFocus}`);
      message = `[${sessionType}] Loaded: ${mostRecent} | Goal: ${goalSummary} | Focus: ${currentFocus}`;
      if (sessionType === "clear" || sessionType === "compact") {
        additionalContext = `Continuity ledger loaded from ${mostRecent}:

${ledgerContent}`;
        const unmarkedHandoffs = getUnmarkedHandoffs();
        if (unmarkedHandoffs.length > 0) {
          additionalContext += `

---

## Unmarked Session Outcomes

`;
          additionalContext += `The following handoffs have no outcome marked. Consider marking them to improve future session recommendations:

`;
          for (const h of unmarkedHandoffs) {
            const taskLabel = h.task_number ? `task-${h.task_number}` : "handoff";
            const summaryPreview = h.task_summary ? h.task_summary.substring(0, 60) + "..." : "(no summary)";
            additionalContext += `- **${h.session_name}/${taskLabel}** (ID: \`${h.id.substring(0, 8)}\`): ${summaryPreview}
`;
          }
          additionalContext += `
To mark an outcome:
\`\`\`bash
uv run python scripts/artifact_mark.py --handoff <ID> --outcome SUCCEEDED|PARTIAL_PLUS|PARTIAL_MINUS|FAILED
\`\`\`
`;
        }
        if (latestHandoff) {
          const handoffPath = path2.join(handoffDir, latestHandoff.filename);
          const handoffContent = fs2.readFileSync(handoffPath, "utf-8");
          const handoffLabel = latestHandoff.isAutoHandoff ? "Latest auto-handoff" : "Latest task handoff";
          additionalContext += `

---

${handoffLabel} (${latestHandoff.filename}):
`;
          additionalContext += `Status: ${latestHandoff.status}${latestHandoff.isAutoHandoff ? "" : ` | Task: ${latestHandoff.taskNumber}`}

`;
          const truncatedHandoff = handoffContent.length > 2e3 ? handoffContent.substring(0, 2e3) + "\n\n[... truncated, read full file if needed]" : handoffContent;
          additionalContext += truncatedHandoff;
          const allHandoffs = fs2.readdirSync(handoffDir).filter((f) => (f.startsWith("task-") || f.startsWith("auto-handoff-")) && f.endsWith(".md")).sort((a, b) => {
            const statA = fs2.statSync(path2.join(handoffDir, a));
            const statB = fs2.statSync(path2.join(handoffDir, b));
            return statB.mtime.getTime() - statA.mtime.getTime();
          });
          if (allHandoffs.length > 1) {
            additionalContext += `

---

All handoffs in ${handoffDir}:
`;
            allHandoffs.forEach((f) => {
              additionalContext += `- ${f}
`;
            });
          }
        }
      }
    }
  } else {
    if (sessionType !== "startup") {
      console.error(`\u26A0 No ledger found. Run /continuity_ledger to track session state.`);
      message = `[${sessionType}] No ledger found. Consider running /continuity_ledger to track session state.`;
    }
  }
  const output = { result: "continue" };
  if (message) {
    output.message = message;
    output.systemMessage = message;
  }
  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: "SessionStart",
      additionalContext
    };
  }
  console.log(JSON.stringify(output));
}
async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}
main().catch(console.error);
