# ADR-000: AI Subscription OAuth Policy Boundary & Zero Harvesting

## Context
Commercial AI providers (Anthropic, OpenAI, Google) operate strict usage policies regarding personal subscription sharing, OAuth proxying, and headless session hijacking. Third-party SaaS products attempting to relay or resell consumer subscription credentials face catastrophic legal and operational termination risks.

## Decision
1. ASO Web will never intercept, copy, proxy, or harvest personal browser session cookies or CLI OAuth cache tokens.
2. The primary inference path for remote executions is BYOK (User API Key) encrypted in a secure vault.
3. For local execution on developer machines, the official local CLI is spawned within the developer's authorized OS session (`apps/local-runner`).
4. Any unverified partner OAuth modes (`PARTNER_OAUTH_APPROVED`) are disabled by default via feature flags and server-side gates.

## Consequences
- Zero account ban risks for users.
- Transparent billing where users pay their direct API provider or use local CLI tooling.
- Full compliance with AI provider Terms of Service.

