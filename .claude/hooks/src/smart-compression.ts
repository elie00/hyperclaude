/**
 * Smart Compression Engine
 * 
 * Intelligently compresses context before handoff by:
 * - Extracting key decisions and learnings
 * - Summarizing file changes
 * - Preserving critical context, removing noise
 */

import * as fs from 'fs';
import * as path from 'path';

interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  summary: string;
  keyDecisions: string[];
  fileChanges: FileChange[];
  preservedContext: string[];
  removedNoise: string[];
}

interface FileChange {
  file: string;
  action: 'created' | 'modified' | 'deleted';
  summary: string;
}

interface TranscriptEntry {
  type: string;
  timestamp?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
}

/**
 * Parse transcript to extract relevant information
 */
function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  if (!fs.existsSync(transcriptPath)) {
    return [];
  }

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const entries: TranscriptEntry[] = [];

  for (const line of content.split('\n').filter(l => l.trim())) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Extract key decisions from conversation
 */
function extractDecisions(entries: TranscriptEntry[]): string[] {
  const decisions: string[] = [];
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
    if (entry.message?.role === 'assistant') {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content.map(c => c.text || '').join(' ');

      // Look for decision patterns
      for (const pattern of decisionPatterns) {
        if (pattern.test(content)) {
          // Extract sentence containing the decision
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

  return decisions.slice(0, 10); // Top 10 decisions
}

/**
 * Extract file changes from tool uses
 */
function extractFileChanges(entries: TranscriptEntry[]): FileChange[] {
  const changes: Map<string, FileChange> = new Map();

  for (const entry of entries) {
    if (entry.tool_name === 'Write' && entry.tool_input?.file_path) {
      const file = entry.tool_input.file_path as string;
      const existing = changes.get(file);
      
      if (!existing) {
        changes.set(file, {
          file,
          action: 'created',
          summary: 'New file created'
        });
      }
    }
    
    if ((entry.tool_name === 'Edit' || entry.tool_name === 'MultiEdit') && entry.tool_input?.file_path) {
      const file = entry.tool_input.file_path as string;
      const existing = changes.get(file);
      
      if (existing) {
        existing.action = 'modified';
        existing.summary = 'File modified';
      } else {
        changes.set(file, {
          file,
          action: 'modified',
          summary: 'File modified'
        });
      }
    }
  }

  return Array.from(changes.values());
}

/**
 * Identify noise patterns that can be removed
 */
const NOISE_PATTERNS = [
  /reading file/i,
  /let me check/i,
  /i'll look at/i,
  /searching for/i,
  /found \d+ results/i,
  /the file contains/i,
  /here's what i found/i,
  /looking at the/i
];

/**
 * Identify context that must be preserved
 */
const PRESERVE_PATTERNS = [
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

/**
 * Compress assistant messages
 */
function compressMessages(entries: TranscriptEntry[]): {
  preserved: string[];
  removed: string[];
} {
  const preserved: string[] = [];
  const removed: string[] = [];

  for (const entry of entries) {
    if (entry.message?.role === 'assistant') {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content.map(c => c.text || '').join(' ');

      // Split into sentences
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);

      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        
        // Check if should preserve
        const shouldPreserve = PRESERVE_PATTERNS.some(p => p.test(trimmed));
        const isNoise = NOISE_PATTERNS.some(p => p.test(trimmed));

        if (shouldPreserve && !isNoise) {
          if (!preserved.includes(trimmed) && trimmed.length < 300) {
            preserved.push(trimmed);
          }
        } else if (isNoise) {
          removed.push(trimmed.slice(0, 50) + '...');
        }
      }
    }
  }

  return { preserved: preserved.slice(0, 20), removed: removed.slice(0, 10) };
}

/**
 * Generate compressed summary
 */
export function compressContext(
  projectDir: string,
  transcriptPath: string
): CompressionResult {
  const entries = parseTranscript(transcriptPath);
  
  // Calculate original size
  const originalContent = fs.existsSync(transcriptPath)
    ? fs.readFileSync(transcriptPath, 'utf-8')
    : '';
  const originalSize = originalContent.length;

  // Extract components
  const decisions = extractDecisions(entries);
  const fileChanges = extractFileChanges(entries);
  const { preserved, removed } = compressMessages(entries);

  // Build compressed summary
  const summaryParts: string[] = [];

  if (decisions.length > 0) {
    summaryParts.push('## Key Decisions\n' + decisions.map(d => `- ${d}`).join('\n'));
  }

  if (fileChanges.length > 0) {
    summaryParts.push('## File Changes\n' + fileChanges.map(f => 
      `- ${f.action}: \`${f.file}\``
    ).join('\n'));
  }

  if (preserved.length > 0) {
    summaryParts.push('## Important Context\n' + preserved.map(p => `- ${p}`).join('\n'));
  }

  const summary = summaryParts.join('\n\n');
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

/**
 * Write compressed context to handoff
 */
export function writeCompressedHandoff(
  projectDir: string,
  sessionName: string,
  compression: CompressionResult
): string {
  const handoffDir = path.join(projectDir, 'thoughts', 'shared', 'handoffs', sessionName);
  
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `compressed-handoff-${timestamp}.md`;
  const filepath = path.join(handoffDir, filename);

  const content = `---
type: compressed-handoff
timestamp: ${new Date().toISOString()}
original_size: ${compression.originalSize}
compressed_size: ${compression.compressedSize}
compression_ratio: ${compression.compressionRatio}%
---

# Compressed Session Handoff

**Compression:** ${compression.compressionRatio}% reduction (${compression.originalSize} → ${compression.compressedSize} chars)

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

/**
 * Get compression preview
 */
export function getCompressionPreview(
  projectDir: string,
  transcriptPath: string
): string {
  const result = compressContext(projectDir, transcriptPath);
  
  return `
📦 COMPRESSION PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Original: ${result.originalSize} chars
Compressed: ${result.compressedSize} chars
Reduction: ${result.compressionRatio}%

Key Decisions: ${result.keyDecisions.length}
File Changes: ${result.fileChanges.length}
Preserved: ${result.preservedContext.length} items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

export { FileChange, CompressionResult };
