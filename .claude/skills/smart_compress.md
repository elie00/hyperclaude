# Smart Compress

## Activation
- `/compress`
- `/smart_compress`
- `compress context`
- `compress handoff`

## Description
Compresse intelligemment le contexte avant un handoff en extrayant uniquement les informations essentielles.

## Instructions

Quand l'utilisateur demande une compression :

### 1. Analyser le Transcript

Examiner le fichier transcript courant pour identifier :
- **Décisions clés** : Choix architecturaux, approches retenues
- **Changements de fichiers** : Créations, modifications, suppressions
- **Contexte important** : Erreurs, bugs, notes, TODOs
- **Bruit à supprimer** : Messages de recherche, lectures de fichiers

### 2. Générer le Résumé Compressé

```markdown
## Key Decisions
- [Liste des décisions importantes]

## File Changes
- created: `path/to/new/file.ts`
- modified: `path/to/existing/file.ts`

## Important Context
- [Points critiques à conserver]

## Statistics
- Original: X chars
- Compressed: Y chars
- Reduction: Z%
```

### 3. Écrire le Handoff Compressé

Sauvegarder dans :
```
thoughts/shared/handoffs/<session>/compressed-handoff-<timestamp>.md
```

### Exemple de Compression

**Avant (5000 chars) :**
```
Je vais regarder le fichier...
Le fichier contient...
Recherche de "X"...
Trouvé 15 résultats...
Je décide d'utiliser l'approche Y car elle est plus maintenable...
[beaucoup de détails de recherche]
```

**Après (800 chars) :**
```
## Key Decisions
- Utiliser l'approche Y pour sa maintenabilité

## File Changes
- modified: `src/component.ts`

## Important Context
- L'ancienne implémentation avait des problèmes de performance

## Statistics
- Reduction: 84%
```

### Quand Utiliser

- Context > 70% : Suggéré
- Context > 85% : Fortement recommandé
- Avant `/clear` : Automatique
- Fin de session : Toujours utile

---

**Note:** La compression préserve l'essentiel tout en réduisant significativement la taille du contexte pour le prochain handoff.
