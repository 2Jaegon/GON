# ADR-001: Separation of ASO Core Orchestrator Package from Web UI

## Context
The core intelligence of ASO consists of intent refinement, task classification (FAST, STANDARD, DEEP), skill routing, DAG dependency planning, and verification gates. Coupling this logic to Fastify HTTP handlers or Next.js React components would prevent CLI reuse, testing in isolation, and horizontal worker scaling.

## Decision
Orchestration logic is housed in a standalone package `packages/aso-core`, depending only on `packages/contracts` and provider/skill interfaces. Fastify API (`apps/api`), background worker (`apps/worker`), and CLI (`gon`) consume `packages/aso-core` as a pure library.

## Consequences
- High testability with zero HTTP/browser dependencies.
- Reusable across CLI, Web backend, and worker daemons.

