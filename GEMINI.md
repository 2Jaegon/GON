# Project Agent Guidance (Gon - Adaptive Skill Orchestrator)

- Read `docs/ARCHITECTURE.md` and `docs/ASO_SPEC.md` for system design and completion criteria.
- Use `plugins/gon/skills/gon/SKILL.md` (or `.agents/skills/gon/SKILL.md`) when relevant.
- Do not add duplicate hooks or load every external skill at startup.
- Prefer narrow, safe tool calls and verifiable test results.
- Measure actual token usage and elapsed time; keep unmeasured fields as `unknown`.
