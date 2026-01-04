/**
 * Notification System
 * 
 * Sends system notifications when important events occur:
 * - Agent completes
 * - Context warning threshold reached
 * - Handoff recommended
 */

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface NotificationOptions {
  title: string;
  message: string;
  sound?: boolean;
  subtitle?: string;
  icon?: 'success' | 'warning' | 'error' | 'info';
}

interface NotificationConfig {
  enabled: boolean;
  soundEnabled: boolean;
  agentComplete: boolean;
  contextWarning: boolean;
  handoffReminder: boolean;
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  soundEnabled: true,
  agentComplete: true,
  contextWarning: true,
  handoffReminder: true
};

/**
 * Load notification config
 */
function loadConfig(projectDir: string): NotificationConfig {
  const configPath = path.join(projectDir, '.claude', 'cache', 'notification-config.json');
  
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  
  return DEFAULT_CONFIG;
}

/**
 * Save notification config
 */
export function saveConfig(projectDir: string, config: Partial<NotificationConfig>): void {
  const configPath = path.join(projectDir, '.claude', 'cache', 'notification-config.json');
  const cacheDir = path.dirname(configPath);
  
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const current = loadConfig(projectDir);
  const updated = { ...current, ...config };
  
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}

/**
 * Check if we're on macOS
 */
function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Send notification via macOS native notifications
 */
function sendMacOSNotification(options: NotificationOptions): void {
  const { title, message, sound, subtitle } = options;
  
  // Build osascript command
  let script = `display notification "${message.replace(/"/g, '\\"')}"`;
  script += ` with title "${title.replace(/"/g, '\\"')}"`;
  
  if (subtitle) {
    script += ` subtitle "${subtitle.replace(/"/g, '\\"')}"`;
  }
  
  if (sound) {
    script += ` sound name "Glass"`;
  }

  try {
    execSync(`osascript -e '${script}'`, { stdio: 'ignore' });
  } catch {
    // Ignore notification errors
  }
}

/**
 * Play a sound (macOS)
 */
function playSound(soundName: 'success' | 'warning' | 'error' | 'info'): void {
  if (!isMacOS()) return;
  
  const sounds: Record<string, string> = {
    success: 'Glass',
    warning: 'Sosumi',
    error: 'Basso',
    info: 'Pop'
  };
  
  const sound = sounds[soundName] || 'Pop';
  
  try {
    exec(`afplay /System/Library/Sounds/${sound}.aiff`, { stdio: 'ignore' });
  } catch {
    // Ignore sound errors
  }
}

/**
 * Send notification with config check
 */
export function notify(projectDir: string, options: NotificationOptions): void {
  const config = loadConfig(projectDir);
  
  if (!config.enabled) return;
  
  // Check specific notification type
  if (options.title.includes('Agent') && !config.agentComplete) return;
  if (options.title.includes('Context') && !config.contextWarning) return;
  if (options.title.includes('Handoff') && !config.handoffReminder) return;
  
  // Send notification
  if (isMacOS()) {
    sendMacOSNotification({
      ...options,
      sound: config.soundEnabled && options.sound !== false
    });
  }
  
  // Also play sound if enabled
  if (config.soundEnabled && options.icon) {
    playSound(options.icon);
  }
}

/**
 * Notify agent completion
 */
export function notifyAgentComplete(
  projectDir: string,
  agentName: string,
  success: boolean,
  metrics?: { toolUses: number; tokensK: number; durationS: number }
): void {
  let message = success ? 'Completed successfully' : 'Finished with issues';
  
  if (metrics) {
    message += ` | ${metrics.toolUses} tools · ${metrics.tokensK}k tokens · ${metrics.durationS}s`;
  }
  
  notify(projectDir, {
    title: `🤖 Agent: ${agentName}`,
    message,
    icon: success ? 'success' : 'warning',
    sound: true
  });
}

/**
 * Notify context warning
 */
export function notifyContextWarning(projectDir: string, contextPct: number): void {
  let title = '';
  let message = '';
  let icon: 'warning' | 'error' = 'warning';
  
  if (contextPct >= 90) {
    title = '⚠️ Context CRITICAL';
    message = `${contextPct}% - Create handoff NOW!`;
    icon = 'error';
  } else if (contextPct >= 80) {
    title = '⚠️ Context Warning';
    message = `${contextPct}% - Consider handoff soon`;
  } else if (contextPct >= 70) {
    title = '📊 Context Update';
    message = `${contextPct}% - Approaching handoff threshold`;
  }
  
  if (title) {
    notify(projectDir, { title, message, icon, sound: contextPct >= 90 });
  }
}

/**
 * Notify handoff recommendation
 */
export function notifyHandoffRecommended(projectDir: string, reason: string): void {
  notify(projectDir, {
    title: '📋 Handoff Recommended',
    message: reason,
    icon: 'info',
    sound: false
  });
}

/**
 * Notify session resumed
 */
export function notifySessionResumed(projectDir: string, handoffName: string): void {
  notify(projectDir, {
    title: '🔄 Session Resumed',
    message: `Continuing from: ${handoffName}`,
    icon: 'success',
    sound: false
  });
}

export { NotificationConfig, NotificationOptions };
