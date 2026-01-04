#!/usr/bin/env python3
"""
Claude Code Dashboard - Real-time metrics visualization

Run: python ~/.claude/scripts/dashboard-server.py
Then open: http://localhost:3847
"""

import json
import os
import http.server
import socketserver
from pathlib import Path
from datetime import datetime
import urllib.parse

PORT = 3847
CLAUDE_DIR = Path.home() / ".claude"

def get_metrics():
    """Gather all metrics from Claude cache"""
    metrics = {
        "timestamp": datetime.now().isoformat(),
        "agents": [],
        "context": {"percentage": 0, "tokens": 0},
        "sessions": [],
        "suggestions_history": [],
        "recent_handoffs": []
    }
    
    # Get agent state
    agents_file = CLAUDE_DIR / "cache" / "agents" / "active-agents.json"
    if agents_file.exists():
        try:
            with open(agents_file) as f:
                data = json.load(f)
                metrics["agents"] = data.get("agents", [])
                metrics["total_tool_uses"] = data.get("total_tool_uses", 0)
                metrics["total_tokens"] = data.get("total_tokens", 0)
        except:
            pass
    
    # Get context percentage from temp file
    for f in Path("/tmp").glob("claude-context-pct-*.txt"):
        try:
            with open(f) as file:
                pct = int(file.read().strip())
                if pct > metrics["context"]["percentage"]:
                    metrics["context"]["percentage"] = pct
        except:
            pass
    
    # Get recent handoffs
    handoffs_dir = Path.cwd() / "thoughts" / "shared" / "handoffs"
    if handoffs_dir.exists():
        handoffs = []
        for session_dir in handoffs_dir.iterdir():
            if session_dir.is_dir():
                for hf in session_dir.glob("*.md"):
                    stat = hf.stat()
                    handoffs.append({
                        "name": hf.name,
                        "session": session_dir.name,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "size": stat.st_size
                    })
        handoffs.sort(key=lambda x: x["modified"], reverse=True)
        metrics["recent_handoffs"] = handoffs[:10]
    
    # Get suggestion history
    history_file = CLAUDE_DIR / "cache" / "suggestion-history.json"
    if history_file.exists():
        try:
            with open(history_file) as f:
                metrics["suggestions_history"] = json.load(f)[-20:]
        except:
            pass
    
    return metrics

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Code Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'SF Mono', 'Fira Code', monospace;
            background: #0a0a0f;
            color: #e0e0e0;
            min-height: 100vh;
            padding: 20px;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #333;
        }
        
        .header h1 {
            font-size: 24px;
            background: linear-gradient(90deg, #00ffff, #ff00ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .status {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #00ff00;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
        }
        
        .card {
            background: #1a1a2e;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #333;
        }
        
        .card h2 {
            font-size: 14px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 15px;
        }
        
        .metric {
            font-size: 36px;
            font-weight: bold;
            color: #00ffff;
        }
        
        .metric.warning { color: #ffaa00; }
        .metric.critical { color: #ff4444; }
        .metric.success { color: #00ff88; }
        
        .agent-list {
            list-style: none;
        }
        
        .agent-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: #252535;
            border-radius: 8px;
            margin-bottom: 10px;
        }
        
        .agent-name {
            font-weight: bold;
            color: #00ffff;
        }
        
        .agent-status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        
        .agent-status.running {
            background: #004400;
            color: #00ff00;
        }
        
        .agent-status.completed {
            background: #333;
            color: #888;
        }
        
        .progress-bar {
            height: 20px;
            background: #252535;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00ffff, #00ff88);
            transition: width 0.5s ease;
        }
        
        .progress-fill.warning {
            background: linear-gradient(90deg, #ffaa00, #ff8800);
        }
        
        .progress-fill.critical {
            background: linear-gradient(90deg, #ff4444, #ff0000);
        }
        
        .handoff-list {
            list-style: none;
        }
        
        .handoff-item {
            padding: 10px;
            background: #252535;
            border-radius: 6px;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .handoff-item .time {
            color: #888;
            font-size: 11px;
        }
        
        .empty {
            color: #555;
            font-style: italic;
        }
        
        .metrics-row {
            display: flex;
            gap: 20px;
            margin-top: 15px;
        }
        
        .mini-metric {
            flex: 1;
            text-align: center;
            padding: 10px;
            background: #252535;
            border-radius: 8px;
        }
        
        .mini-metric .value {
            font-size: 24px;
            font-weight: bold;
            color: #00ffff;
        }
        
        .mini-metric .label {
            font-size: 11px;
            color: #888;
            margin-top: 5px;
        }
        
        .refresh-info {
            text-align: center;
            color: #555;
            font-size: 12px;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>⚡ Claude Code Dashboard</h1>
        <div class="status">
            <div class="status-dot"></div>
            <span id="update-time">Connecting...</span>
        </div>
    </div>
    
    <div class="grid">
        <div class="card">
            <h2>📊 Context Usage</h2>
            <div class="metric" id="context-pct">--</div>
            <div class="progress-bar">
                <div class="progress-fill" id="context-bar" style="width: 0%"></div>
            </div>
            <div class="metrics-row">
                <div class="mini-metric">
                    <div class="value" id="total-tokens">--</div>
                    <div class="label">Total Tokens</div>
                </div>
                <div class="mini-metric">
                    <div class="value" id="total-tools">--</div>
                    <div class="label">Tool Uses</div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>🤖 Active Agents</h2>
            <ul class="agent-list" id="agent-list">
                <li class="empty">No active agents</li>
            </ul>
        </div>
        
        <div class="card">
            <h2>📋 Recent Handoffs</h2>
            <ul class="handoff-list" id="handoff-list">
                <li class="empty">No handoffs found</li>
            </ul>
        </div>
        
        <div class="card">
            <h2>📈 Agent History</h2>
            <div id="history-chart">
                <p class="empty">Collecting data...</p>
            </div>
        </div>
    </div>
    
    <div class="refresh-info">
        Auto-refreshes every 2 seconds
    </div>
    
    <script>
        function formatTokens(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return n.toString();
        }
        
        function formatTime(isoString) {
            const date = new Date(isoString);
            const now = new Date();
            const diff = (now - date) / 1000 / 60; // minutes
            
            if (diff < 1) return 'just now';
            if (diff < 60) return Math.round(diff) + 'm ago';
            if (diff < 24 * 60) return Math.round(diff / 60) + 'h ago';
            return Math.round(diff / 60 / 24) + 'd ago';
        }
        
        function updateDashboard(data) {
            // Update context
            const pct = data.context.percentage;
            document.getElementById('context-pct').textContent = pct + '%';
            document.getElementById('context-pct').className = 'metric ' + 
                (pct >= 80 ? 'critical' : pct >= 60 ? 'warning' : 'success');
            
            const bar = document.getElementById('context-bar');
            bar.style.width = pct + '%';
            bar.className = 'progress-fill ' + 
                (pct >= 80 ? 'critical' : pct >= 60 ? 'warning' : '');
            
            // Update totals
            document.getElementById('total-tokens').textContent = formatTokens(data.total_tokens || 0);
            document.getElementById('total-tools').textContent = data.total_tool_uses || 0;
            
            // Update agents
            const agentList = document.getElementById('agent-list');
            if (data.agents && data.agents.length > 0) {
                agentList.innerHTML = data.agents.map(a => `
                    <li class="agent-item">
                        <div>
                            <div class="agent-name">${a.name}</div>
                            <div style="font-size: 12px; color: #888">
                                ${a.tool_uses} tools · ${formatTokens(a.tokens_used)} tokens
                                ${a.current_phase ? ' · ' + a.current_phase : ''}
                            </div>
                        </div>
                        <span class="agent-status ${a.status}">${a.status}</span>
                    </li>
                `).join('');
            } else {
                agentList.innerHTML = '<li class="empty">No active agents</li>';
            }
            
            // Update handoffs
            const handoffList = document.getElementById('handoff-list');
            if (data.recent_handoffs && data.recent_handoffs.length > 0) {
                handoffList.innerHTML = data.recent_handoffs.slice(0, 5).map(h => `
                    <li class="handoff-item">
                        <div>${h.name}</div>
                        <div class="time">${h.session} · ${formatTime(h.modified)}</div>
                    </li>
                `).join('');
            } else {
                handoffList.innerHTML = '<li class="empty">No handoffs found</li>';
            }
            
            // Update time
            document.getElementById('update-time').textContent = 
                'Updated: ' + new Date().toLocaleTimeString();
        }
        
        async function fetchMetrics() {
            try {
                const response = await fetch('/api/metrics');
                const data = await response.json();
                updateDashboard(data);
            } catch (e) {
                console.error('Failed to fetch metrics:', e);
            }
        }
        
        // Initial fetch
        fetchMetrics();
        
        // Auto-refresh every 2 seconds
        setInterval(fetchMetrics, 2000);
    </script>
</body>
</html>
"""

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        if parsed.path == '/' or parsed.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(DASHBOARD_HTML.encode())
        
        elif parsed.path == '/api/metrics':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            metrics = get_metrics()
            self.wfile.write(json.dumps(metrics).encode())
        
        else:
            self.send_error(404)
    
    def log_message(self, format, *args):
        pass  # Suppress logging

def main():
    print(f"""
╔═══════════════════════════════════════════════════════════╗
║         ⚡ Claude Code Dashboard Server                    ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Dashboard: http://localhost:{PORT}                        ║
║   API:       http://localhost:{PORT}/api/metrics            ║
║                                                           ║
║   Press Ctrl+C to stop                                    ║
╚═══════════════════════════════════════════════════════════╝
""")
    
    with socketserver.TCPServer(("", PORT), DashboardHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDashboard stopped.")

if __name__ == "__main__":
    main()
