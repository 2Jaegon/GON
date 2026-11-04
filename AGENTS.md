# Project Agent Guidance (Gon - Adaptive Skill Orchestrator)

- Read `docs/ARCHITECTURE.md` and `docs/ASO_SPEC.md` when maintaining this project.
- Follow `.agents/skills/gon/SKILL.md` (synchronized from `plugins/gon/skills/gon/`) for orchestration workflows.
- Single top-level planner: route only minimal skills and verify actual changes with tests.
- Report measured token usage and elapsed time only when available; otherwise set `null`/`unknown`.
