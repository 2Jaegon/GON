# ASO Web Architectural Decisions & Risk Ledger

## 1. Status Overview

- **Document Version:** 1.0.0
- **As of Date:** 2026-11-04
- **Specification Source:** [`docs/ASO_WEB_APP_SPEC.md`](file:///c:/Users/aicam/Desktop/수업_AX_W/수업/gon/docs/ASO_WEB_APP_SPEC.md)

---

## 2. Assumptions (ASSUMPTION)

1. **[ASSUMPTION-001] Local-First Development Target:**
   - In M0/M1, developer workloads execute primarily via the `Local Runner` on user machines and `MockProvider` in automated tests.
   - Cloud sandbox infrastructure (Docker/OCI/K8s) is an M2 milestone and disabled by default via feature flags.

2. **[ASSUMPTION-002] Multi-Engine Compatibility:**
   - Claude Code, Codex CLI, and Gemini CLI are supported as target environments without favoring proprietary APIs or proprietary tokens.
   - For all providers, BYOK (user API key stored in encrypted vault) is the baseline standard.

3. **[ASSUMPTION-003] Zero-Credential Harvesting:**
   - No browser session cookies, CLI OAuth cache tokens, or personal subscription credentials are intercepted, proxied, or stored by ASO Web backend.
   - Unverified partner integrations remain strictly disabled (`legalGate: "blocked"` or `"pending"`).

4. **[ASSUMPTION-004] Dual Database Operation Mode:**
   - Production / Docker mode uses PostgreSQL 17 + Redis 7 + MinIO (configured in [`infra/compose.yaml`](file:///c:/Users/aicam/Desktop/수업_AX_W/수업/gon/infra/compose.yaml)).
   - Local dev / unit test mode supports zero-dependency in-memory repository abstractions to enable lightning-fast CI and offline development without mandatory Docker daemon availability.

---

## 3. Blockers & Risks (BLOCKER)

1. **[BLOCKER-001] Commercial Subscription OAuth Redistribution:**
   - **Risk:** Reselling personal subscriptions or harvesting OAuth CLI tokens violates provider Terms of Service and API policies.
   - **Resolution:** Gated to `false` in `config/feature-flags.json`. Only BYOK and sanctioned Local Runner CLI paths are exposed.

2. **[BLOCKER-002] Path Traversal & Unbounded Local File Modification:**
   - **Risk:** Malicious or hallucinated task contracts could overwrite sensitive OS files (`~/.ssh`, Windows registry, system binaries).
   - **Resolution:** Local Runner strictly enforces directory boundaries (`isPathInside`), rejects relative parent traversal (`..`), symbolic links pointing outside, and reserved device names (Windows CON, PRN, AUX, etc.).

3. **[BLOCKER-003] Token Quota & Cost Hallucination:**
   - **Risk:** CLI subscription modes may not expose exact token billing dollar amounts; hallucinating zero cost or arbitrary savings misleads users.
   - **Resolution:** `cost_confidence` field in `usage_ledger`. When exact dollars are unmeasured, record status as `unavailable` or `estimated` with basis, never fake zeros.

