// src/notifications.ts
import { execSync, exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
var DEFAULT_CONFIG = {
  enabled: true,
  soundEnabled: true,
  agentComplete: true,
  contextWarning: true,
  handoffReminder: true
};
function loadConfig(projectDir) {
  const configPath = path.join(projectDir, ".claude", "cache", "notification-config.json");
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}
function saveConfig(projectDir, config) {
  const configPath = path.join(projectDir, ".claude", "cache", "notification-config.json");
  const cacheDir = path.dirname(configPath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const current = loadConfig(projectDir);
  const updated = { ...current, ...config };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
}
function isMacOS() {
  return process.platform === "darwin";
}
function sendMacOSNotification(options) {
  const { title, message, sound, subtitle } = options;
  let script = `display notification "${message.replace(/"/g, '\\"')}"`;
  script += ` with title "${title.replace(/"/g, '\\"')}"`;
  if (subtitle) {
    script += ` subtitle "${subtitle.replace(/"/g, '\\"')}"`;
  }
  if (sound) {
    script += ` sound name "Glass"`;
  }
  try {
    execSync(`osascript -e '${script}'`, { stdio: "ignore" });
  } catch {
  }
}
function playSound(soundName) {
  if (!isMacOS()) return;
  const sounds = {
    success: "Glass",
    warning: "Sosumi",
    error: "Basso",
    info: "Pop"
  };
  const sound = sounds[soundName] || "Pop";
  try {
    exec(`afplay /System/Library/Sounds/${sound}.aiff`, { stdio: "ignore" });
  } catch {
  }
}
function notify(projectDir, options) {
  const config = loadConfig(projectDir);
  if (!config.enabled) return;
  if (options.title.includes("Agent") && !config.agentComplete) return;
  if (options.title.includes("Context") && !config.contextWarning) return;
  if (options.title.includes("Handoff") && !config.handoffReminder) return;
  if (isMacOS()) {
    sendMacOSNotification({
      ...options,
      sound: config.soundEnabled && options.sound !== false
    });
  }
  if (config.soundEnabled && options.icon) {
    playSound(options.icon);
  }
}
function notifyAgentComplete(projectDir, agentName, success, metrics) {
  let message = success ? "Completed successfully" : "Finished with issues";
  if (metrics) {
    message += ` | ${metrics.toolUses} tools \xB7 ${metrics.tokensK}k tokens \xB7 ${metrics.durationS}s`;
  }
  notify(projectDir, {
    title: `\u{1F916} Agent: ${agentName}`,
    message,
    icon: success ? "success" : "warning",
    sound: true
  });
}
function notifyContextWarning(projectDir, contextPct) {
  let title = "";
  let message = "";
  let icon = "warning";
  if (contextPct >= 90) {
    title = "\u26A0\uFE0F Context CRITICAL";
    message = `${contextPct}% - Create handoff NOW!`;
    icon = "error";
  } else if (contextPct >= 80) {
    title = "\u26A0\uFE0F Context Warning";
    message = `${contextPct}% - Consider handoff soon`;
  } else if (contextPct >= 70) {
    title = "\u{1F4CA} Context Update";
    message = `${contextPct}% - Approaching handoff threshold`;
  }
  if (title) {
    notify(projectDir, { title, message, icon, sound: contextPct >= 90 });
  }
}
function notifyHandoffRecommended(projectDir, reason) {
  notify(projectDir, {
    title: "\u{1F4CB} Handoff Recommended",
    message: reason,
    icon: "info",
    sound: false
  });
}
function notifySessionResumed(projectDir, handoffName) {
  notify(projectDir, {
    title: "\u{1F504} Session Resumed",
    message: `Continuing from: ${handoffName}`,
    icon: "success",
    sound: false
  });
}
export {
  notify,
  notifyAgentComplete,
  notifyContextWarning,
  notifyHandoffRecommended,
  notifySessionResumed,
  saveConfig
};
