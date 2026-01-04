// src/smart-compression.ts
import * as fs from "fs";
import * as path from "path";
function parseTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return [];
  }
  const content = fs.readFileSync(transcriptPath, "utf-8");
  const entries = [];
  for (const line of content.split("\n").filter((l) => l.trim())) {
    try {
      entries.push(JSON.parse(line));
    } catch {
    }
  }
  return entries;
}
function extractDecisions(entries) {
  const decisions = [];
  const decisionPatterns = [
    /decided to/i,
    /chose to/i,
    /will use/i,
    /going with/i,
    /approach:/i,
    /solution:/i,
    /because/i,
    /the best way/i,
    /instead of/i
  ];
  for (const entry of entries) {
    if (entry.message?.role === "assistant") {
      const content = typeof entry.message.content === "string" ? entry.message.content : entry.message.content.map((c) => c.text || "").join(" ");
      for (const pattern of decisionPatterns) {
        if (pattern.test(content)) {
          const sentences = content.split(/[.!?]+/);
          for (const sentence of sentences) {
            if (pattern.test(sentence) && sentence.length > 20 && sentence.length < 200) {
              const cleaned = sentence.trim();
              if (!decisions.includes(cleaned)) {
                decisions.push(cleaned);
              }
              break;
            }
          }
        }
      }
    }
  }
  return decisions.slice(0, 10);
}
function extractFileChanges(entries) {
  const changes = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry.tool_name === "Write" && entry.tool_input?.file_path) {
      const file = entry.tool_input.file_path;
      const existing = changes.get(file);
      if (!existing) {
        changes.set(file, {
          file,
          action: "created",
          summary: "New file created"
        });
      }
    }
    if ((entry.tool_name === "Edit" || entry.tool_name === "MultiEdit") && entry.tool_input?.file_path) {
      const file = entry.tool_input.file_path;
      const existing = changes.get(file);
      if (existing) {
        existing.action = "modified";
        existing.summary = "File modified";
      } else {
        changes.set(file, {
          file,
          action: "modified",
          summary: "File modified"
        });
      }
    }
  }
  return Array.from(changes.values());
}
var NOISE_PATTERNS = [
  /reading file/i,
  /let me check/i,
  /i'll look at/i,
  /searching for/i,
  /found \d+ results/i,
  /the file contains/i,
  /here's what i found/i,
  /looking at the/i
];
var PRESERVE_PATTERNS = [
  /error:/i,
  /bug:/i,
  /fix:/i,
  /important:/i,
  /note:/i,
  /warning:/i,
  /todo:/i,
  /decision:/i,
  /because/i,
  /the reason/i
];
function compressMessages(entries) {
  const preserved = [];
  const removed = [];
  for (const entry of entries) {
    if (entry.message?.role === "assistant") {
      const content = typeof entry.message.content === "string" ? entry.message.content : entry.message.content.map((c) => c.text || "").join(" ");
      const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 10);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        const shouldPreserve = PRESERVE_PATTERNS.some((p) => p.test(trimmed));
        const isNoise = NOISE_PATTERNS.some((p) => p.test(trimmed));
        if (shouldPreserve && !isNoise) {
          if (!preserved.includes(trimmed) && trimmed.length < 300) {
            preserved.push(trimmed);
          }
        } else if (isNoise) {
          removed.push(trimmed.slice(0, 50) + "...");
        }
      }
    }
  }
  return { preserved: preserved.slice(0, 20), removed: removed.slice(0, 10) };
}
function compressContext(projectDir, transcriptPath) {
  const entries = parseTranscript(transcriptPath);
  const originalContent = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf-8") : "";
  const originalSize = originalContent.length;
  const decisions = extractDecisions(entries);
  const fileChanges = extractFileChanges(entries);
  const { preserved, removed } = compressMessages(entries);
  const summaryParts = [];
  if (decisions.length > 0) {
    summaryParts.push("## Key Decisions\n" + decisions.map((d) => `- ${d}`).join("\n"));
  }
  if (fileChanges.length > 0) {
    summaryParts.push("## File Changes\n" + fileChanges.map(
      (f) => `- ${f.action}: \`${f.file}\``
    ).join("\n"));
  }
  if (preserved.length > 0) {
    summaryParts.push("## Important Context\n" + preserved.map((p) => `- ${p}`).join("\n"));
  }
  const summary = summaryParts.join("\n\n");
  const compressedSize = summary.length;
  return {
    originalSize,
    compressedSize,
    compressionRatio: originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0,
    summary,
    keyDecisions: decisions,
    fileChanges,
    preservedContext: preserved,
    removedNoise: removed
  };
}
function writeCompressedHandoff(projectDir, sessionName, compression) {
  const handoffDir = path.join(projectDir, "thoughts", "shared", "handoffs", sessionName);
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const filename = `compressed-handoff-${timestamp}.md`;
  const filepath = path.join(handoffDir, filename);
  const content = `---
type: compressed-handoff
timestamp: ${(/* @__PURE__ */ new Date()).toISOString()}
original_size: ${compression.originalSize}
compressed_size: ${compression.compressedSize}
compression_ratio: ${compression.compressionRatio}%
---

# Compressed Session Handoff

**Compression:** ${compression.compressionRatio}% reduction (${compression.originalSize} \u2192 ${compression.compressedSize} chars)

${compression.summary}

---

## Statistics

- **Key Decisions:** ${compression.keyDecisions.length}
- **File Changes:** ${compression.fileChanges.length}
- **Preserved Context:** ${compression.preservedContext.length} items
- **Removed Noise:** ${compression.removedNoise.length} items
`;
  fs.writeFileSync(filepath, content);
  return filepath;
}
function getCompressionPreview(projectDir, transcriptPath) {
  const result = compressContext(projectDir, transcriptPath);
  return `
\u{1F4E6} COMPRESSION PREVIEW
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Original: ${result.originalSize} chars
Compressed: ${result.compressedSize} chars
Reduction: ${result.compressionRatio}%

Key Decisions: ${result.keyDecisions.length}
File Changes: ${result.fileChanges.length}
Preserved: ${result.preservedContext.length} items
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`;
}
export {
  compressContext,
  getCompressionPreview,
  writeCompressedHandoff
};
