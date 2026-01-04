---
name: glm-delegate
description: Delegate code generation to GLM-4.7 while Claude handles planning and review
---

# Claude-GLM Orchestration

Claude plans → GLM generates → Claude reviews.

## Workflow

### 1. Plan (Claude)
First, plan what needs to be generated:
- Define the specifications
- Break down into components
- Specify requirements

### 2. Delegate to GLM
```bash
uv run python scripts/glm_delegate.py \
    --task "implement user authentication REST API" \
    --language python \
    --context "Use FastAPI, JWT tokens, bcrypt for passwords"
```

### 3. Review (Claude)
After GLM generates:
- Review the code for correctness
- Check for security issues
- Optimize if needed
- Integrate into the project

## When to Use GLM

**Delegate to GLM:**
- Boilerplate code
- CRUD operations
- Initial prototypes
- Repetitive patterns
- Simple utilities

**Keep in Claude:**
- Architecture decisions
- Security-critical code
- Complex algorithms
- Code review
- Debugging

## Triggers

Say any of these:
- "delegate to glm"
- "let glm generate"
- "use glm for generation"
- "generate with glm and review"
