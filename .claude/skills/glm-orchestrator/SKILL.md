---
name: glm-orchestrator
description: Generate code using GLM-4.7 - fast and cost-effective
---

# GLM-4.7 Code Generation

Use GLM-4.7 for fast, cost-effective code generation via the model-orchestrator.

## When to Use

- **Rapid prototyping** - Quick initial implementations
- **Boilerplate code** - CRUD, models, schemas
- **Simple utilities** - Helper functions, formatters
- **High-volume generation** - Multiple files at once

## Available Tools

### glm_generate
Generate code quickly. Best for prototypes and initial implementations.

```bash
uv run python -m runtime.harness scripts/glm_generate.py \
    --prompt "create a REST API endpoint for user authentication" \
    --language python
```

### glm_chat
General conversation with GLM-4.7.

### glm_explain
Get GLM to explain code.

## Workflow

1. **Generate with GLM** → Fast initial code
2. **Review yourself** → Refine and optimize
3. **Final polish** → Production-ready code

## Triggers

Say any of these to activate:
- "use glm to generate..."
- "fast code generation"
- "generate with glm"
- "prototype quickly"
