# Dashboard

## Activation
- `/dashboard`
- `open dashboard`
- `show metrics`
- `monitoring`

## Description
Lance le tableau de bord temps réel pour visualiser les métriques Claude Code.

## Instructions

### Lancer le Dashboard

```bash
# Démarrer le serveur dashboard
python ~/.claude/scripts/dashboard-server.py &

# Ouvrir dans le navigateur
open http://localhost:3847
```

### Fonctionnalités

Le dashboard affiche en temps réel :

1. **Context Usage**
   - Pourcentage d'utilisation du contexte
   - Barre de progression avec code couleur
   - Tokens totaux et tool uses

2. **Active Agents**
   - Liste des agents en cours d'exécution
   - Métriques par agent (tools, tokens, durée)
   - Status en temps réel

3. **Recent Handoffs**
   - 5 derniers handoffs
   - Temps écoulé depuis chaque handoff
   - Session d'origine

4. **Agent History**
   - Historique des exécutions d'agents
   - Outcomes (success/partial/failed)

### Arrêter le Dashboard

```bash
# Trouver le PID du serveur
lsof -i :3847

# Arrêter le serveur
pkill -f "dashboard-server.py"
```

### Configuration

Le dashboard lit automatiquement :
- `~/.claude/cache/agents/active-agents.json`
- `/tmp/claude-context-pct-*.txt`
- `thoughts/shared/handoffs/`
- `~/.claude/cache/suggestion-history.json`

---

**Note:** Le dashboard se rafraîchit automatiquement toutes les 2 secondes.
