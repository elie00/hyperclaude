# Guide de démarrage rapide - Continuous Claude amélioré

## ✅ Installation terminée !

Les améliorations sont installées dans `~/.claude/` et seront actives dans **tous tes projets Claude Code**.

---

## 🚀 Première utilisation

### 1. Redémarre Claude Code

**IMPORTANT :** Ferme complètement Claude Code et relance-le pour charger les nouveaux hooks.

### 2. Vérifie la StatusLine

En bas de l'écran, tu devrais voir quelque chose comme :
```
45.2K 23% | main U:3 | ✓ Last task → Current focus
```

Au lieu de la StatusLine basique par défaut.

---

## 🎯 Fonctionnalités actives

### StatusLine enrichie

| Élément | Description |
|---------|-------------|
| `148.6K 74%` | Tokens utilisés + % de contexte (couleur verte < 60%, jaune 60-79%, rouge ≥ 80%) |
| `main U:6 A:8` | Branche git + Unstaged:6 + Added:8 |
| `🤖2 (PL:86k RE:95k)` | 2 agents actifs avec tokens par agent |
| `✓ Last → Focus` | Dernière tâche terminée → Tâche actuelle |

### Auto-orchestration

À partir de **70% de contexte**, Claude suggère automatiquement :
```
● Context at 73% - I'll run P2 and P3 in parallel to maximize efficiency before handoff:
```

### Tracking des agents

Quand tu lances un agent avec `Task`, le système track :
- Nombre d'outils utilisés
- Tokens consommés
- Durée d'exécution
- Phase TDD (RED/GREEN/REFACTOR)

---

## 📝 Initialiser un projet pour la continuité

Dans chaque projet où tu veux utiliser ledger/handoff :

```bash
cd ton-projet

# Créer les répertoires
mkdir -p thoughts/ledgers
mkdir -p thoughts/shared/handoffs
mkdir -p thoughts/shared/plans
mkdir -p .claude/cache/agents

# Créer un ledger initial
cat > thoughts/ledgers/CONTINUITY_CLAUDE-$(basename $(pwd)).md << 'EOF'
# Session: $(basename $(pwd))

## Goal
[Décris ton objectif principal pour ce projet]

## Progress
- Now: [Tâche actuelle]
- Next: [Tâche suivante]

## Architecture Summary
[Notes sur l'archi du projet]
EOF
```

---

## 🧪 Tester les améliorations

### Test 1 : StatusLine

Lance Claude Code et vérifie que la barre en bas affiche les infos enrichies.

### Test 2 : Agent tracking

```
Toi : "create a plan for implementing feature X"
Claude : [Lance plan-agent via Task]
StatusLine : Affiche 🤖1 (PL:0k) qui augmente progressivement
```

### Test 3 : Auto-orchestration

Crée un ledger avec plusieurs tâches :
```markdown
## Progress
- Now: P1 - Implémenter auth
- Next: P2 - Tests unitaires
- Next: P3 - Documentation
```

Quand le contexte atteint ~75%, Claude dira :
```
● Context at 75% - I'll run P2 and P3 in parallel...
```

---

## 🛠️ Commandes disponibles

| Dis ceci | Ce qui se passe |
|----------|------------------|
| `"save state"` | Sauvegarde l'état dans le ledger |
| `"create handoff"` | Crée un document de passation de session |
| `"resume from handoff"` | Reprend à partir d'un handoff |
| `"create plan"` | Lance plan-agent |
| `"debug this issue"` | Lance debug-agent |
| `"research X"` | Lance research-agent |
| `"explore the codebase"` | Lance rp-explorer |

---

## 📂 Structure installée

```
~/.claude/
├── hooks/
│   ├── dist/               # Hooks compilés (.mjs)
│   │   ├── agent-start-tracker.mjs    # 🆕 Track démarrage agents
│   │   ├── agent-tracker.mjs          # 🆕 Module de tracking
│   │   ├── auto-orchestration.mjs     # 🆕 Orchestration intelligente
│   │   └── ...
│   ├── src/                # Sources TypeScript
│   └── *.sh                # Wrappers shell
├── scripts/
│   └── status.sh           # 🆕 StatusLine enrichie
├── skills/                 # 35+ skills
├── agents/                 # 30+ agents
├── rules/                  # Règles comportementales
├── plugins/                # Braintrust tracing
└── settings.local.json     # Configuration active

```

---

## 🐛 Dépannage

### Les hooks ne se chargent pas

```bash
# Vérifier que settings.local.json contient les hooks
cat ~/.claude/settings.local.json | jq '.hooks | keys'

# Doit afficher : ["PreToolUse", "PreCompact", "SessionStart", ...]
```

Si vide → Relance l'installation :
```bash
cd /Users/eybo/PycharmProjects/Continuous-Claude-v2
./install-global.sh  # (à créer si besoin)
```

### La StatusLine n'affiche pas les agents

```bash
# Vérifier le fichier d'état
cat ~/.claude/cache/agents/active-agents.json | jq '.agents'
```

### Logs de debug

```bash
# Voir le log de la session actuelle
tail -100 ~/.claude/debug/latest | grep -i hook
```

---

## 🔄 Modifier les hooks

Si tu veux modifier le comportement :

```bash
cd ~/.claude/hooks

# Modifier les sources TypeScript
vim src/agent-tracker.ts

# Recompiler
npm run build

# Redémarrer Claude Code
```

---

## 📊 Métriques disponibles

Le fichier `.claude/cache/agents/active-agents.json` contient :

```json
{
  "version": "1.0.0",
  "session_id": "...",
  "agents": [
    {
      "id": "plan-agent-abc-123",
      "name": "plan-agent",
      "status": "running",
      "tool_uses": 8,
      "tokens_used": 86000,
      "duration_ms": 45000,
      "current_phase": "GREEN"
    }
  ],
  "total_tool_uses": 17,
  "total_tokens": 181500
}
```

---

## 🎉 Profite du système amélioré !

Tu as maintenant :
- ✅ StatusLine temps réel avec agents
- ✅ Auto-orchestration intelligente
- ✅ Tracking complet des agents
- ✅ 35+ skills prêts à l'emploi
- ✅ 30+ agents spécialisés

**Besoin d'aide ?** Les logs sont dans `~/.claude/debug/latest`
