---
title: ASO Web — 멀티모델·멀티스킬 개발 자동화 웹 앱 상세 구현 설계서
version: 1.0.0
document_type: product-requirements-and-technical-implementation-blueprint
status: 설계 완료 / 소스코드 미구현 / 벤치마크 미실측
as_of: 2026-11-04
language: ko-KR
primary_audience: Claude Code, Codex CLI, Gemini CLI, human engineers
related_document: Adaptive_Skill_Orchestrator_Implementation_Spec_KO.md
---

# ASO Web — Adaptive Skill Orchestrator Web Application

> **이 문서는 무엇인가?** Claude Code, Codex CLI, Gemini CLI 등 AI 코딩 도구가 파일을 읽고 실제 상용 웹 앱의 MVP부터 확장형 제품까지 구현할 수 있게 작성한 **제품 요구사항(PRD) + 시스템 아키텍처 + API 계약 + 데이터 모델 + 보안/운영/테스트 + 단계별 구현 작업지시서**다.
>
> **현재 상태:** 설계 문서다. 이하의 코드·엔드포인트·가격·성능 목표는 구현 계약 또는 예시이며, 실제 서비스가 이미 동작하거나 법률 검토·벤치마크를 완료했다는 뜻이 아니다.
>
> **AI 개발 에이전트에 대한 최상위 지시:** 이 문서의 `Phase 0`부터 순서대로 실제 코드를 작성한다. 현재 리포지토리를 조사한 뒤 기존 코드와 충돌을 방지한다. 기능을 구현했다고 주장하기 전에 빌드·테스트·실행 결과를 남긴다. **외부 AI 구독의 OAuth 토큰을 수집/중계하는 기능을 임의 구현하지 않는다.** 정책 불확실 항목은 feature flag를 끈 상태로 두고 BYOK 또는 허용된 로컬 실행 경로를 먼저 구현한다.

## 문서 목차

1. 제품 목표·범위·성공 정의
2. 사용자 역할과 전체 경험
3. 구독·API·CLI 연결의 정책 및 기능 게이트
4. 시스템 아키텍처와 기술 스택
5. 모노레포 및 책임 경계
6. UX 화면·상태·동선 상세
7. 도메인 모델·DB 스키마
8. 백엔드 API 계약
9. 이벤트·실시간 통신 계약
10. 로컬 실행기 및 기기 페어링
11. 클라우드 샌드박스·GitHub 연동
12. AI 제공사 어댑터 구현
13. ASO 스킬 오케스트레이션 엔진
14. Task DAG·동시성·워크플로 복구
15. 비용·캐싱·관측·벤치마크
16. 보안·공급망·권한·컴플라이언스
17. 요금제·결제·기능 한도
18. 테스트 전략과 수용 조건
19. 로컬 개발·CI/CD·배포·운영
20. 단계별 구현 백로그와 인수 기준
21. CLI별 구현 지시문
22. 위험·미결정 사항·출시 게이트
23. 공식 참고문서
24. 부록: 계약 스키마와 예시 코드
25. 최종 구현 원칙·인수 체크리스트

---

# 1. 제품 목표·범위·성공 정의

## 1.1 한 문장 정의

**사용자는 만들고 싶은 것을 자연어로 설명하고, ASO Web은 목표 구체화 → 개발 계획 → 최소 스킬/모델 선택 → 의존성 기반 병렬 구현 → 테스트 → 결과 전달을 자동 조율한다.**

## 1.2 해결할 문제

- 사용자는 Superpowers, ECC, find-skills 등 스킬을 별도로 찾고 설치해야 한다.
- 모호한 요청을 고급 요구사항으로 바꾸는 일이 모델과 사용자에 따라 편차가 크다.
- 복잡한 작업에서는 에이전트가 중복 기획/검색/파일 읽기를 반복하며 비용이 증가한다.
- 여러 에이전트를 병렬로 실행하면 파일 충돌, 통합 재작업, 토큰 증가가 발생한다.
- 개인의 Claude/Codex/Gemini 이용 환경을 활용하고 싶지만 제공사마다 인증·과금·약관이 다르다.
- 결과의 품질·비용·경과시간을 사용자와 운영자가 신뢰할 수 있는 방식으로 비교하기 어렵다.

## 1.3 제품 차별화와 가치 제안

- **AI 모델 선택 서비스가 아니라 작업 결과 최적화 서비스**다.
- 모델 연결은 수단이며, 차별화는 `Intent Engine`, `Skill Router`, `DAG Scheduler`, `Verification Gate`, `Benchmark Feedback`에 있다.
- 동일 과제의 기존 CLI 사용 대비 성공률·소요시간·실효비용을 객관적으로 비교한다.
- 최종 사용자에게는 AI 내부 지시가 아닌 **실행 가능 결과물, 변경사항, 테스트 증거, 승인 요청**을 보여준다.

## 1.4 출시 단계 구분

| 단계 | 제품 | 대상 | 필수 기능 | 제외 |
|---|---|---|---|---|
| M0 | 로컬 개발자 알파 | 본인/소수 개발자 | 로그인, 프로젝트, BYOK, 로컬 러너, 단일 모델/FAST, 작업 이벤트 | 유료결제, 클라우드 원격 실행 |
| M1 | 개발자 웹 앱 MVP | 개인 개발자 | GitHub App, 계획, Skill Registry, STANDARD, 테스트 결과, 사용량 대시보드 | 팀, 자동 배포, 모든 제공사 OAuth |
| M2 | 적응형 개발 플랫폼 | 개발팀/1인 빌더 | DAG 병렬, ECC 전문 스킬, DEEP, 클라우드 샌드박스, PR, 비교 실험 | 비개발자 원클릭 완성 보장 |
| M3 | 상용 SaaS | 소규모 팀 | 과금, 워크스페이스 RBAC, 조직 정책, 감사로그, 운영 대시보드 | 임의 구독 재판매/우회 |

## 1.5 초기 릴리스의 명시적 비목표

- 사용자의 ChatGPT/Claude/Gemini 비밀번호를 ASO가 직접 받는 방식.
- CLI의 OAuth 토큰·쿠키·인증 캐시를 복사해 클라우드 서버에 전달하는 방식.
- 사용자가 승인하지 않은 저장소 삭제, 운영 배포, 외부 데이터 전송, 결제.
- 세 모델에 모든 요청을 동시에 전송하는 무조건적 앙상블.
- ECC 전체를 모든 작업에 강제 적용하거나 모든 훅을 전역 활성화하는 방식.
- 실제 측정 없이 '항상 25% 저렴', '100% 고품질'을 보장하는 마케팅.
- 초기 출시에서 브라우저가 사용자 로컬 디렉터리에 직접 쓰기 권한을 갖는 방식.

## 1.6 제품 성공 지표 및 정의

| 지표 | 정의 | 초기 목표(가설) |
|---|---|---|
| End-to-end 성공률 | 정의된 수용기준 전부 통과한 작업 / 전체 평가 작업 | 기본 CLI 이상 |
| 완료시간(TTC) | 작업 요청 승인 시점부터 검증 종료까지 wall-clock | 비교군 대비 20% 감소 목표 |
| 실효비용 | 실제 측정된 API 비용 + 러너/샌드박스 원가 + 재시도 비용 | 동일 품질 기준 25% 감소 목표 |
| 기능 충족률 | 수용기준 별 pass 합계 / 평가 기준 합계 | 기본 CLI 이상 |
| 결함 심각도 | 배포 전 독립 리뷰로 발견한 치명/높음 결함 건수 | 기본 CLI 이하 |
| 반복 질문 수 | 작업마다 필수 확인을 제외한 불필요 질문 수 | 기본 CLI 이하 |
| 코드 변경 범위 | 요청과 무관한 파일 변경 수 / 전체 변경 파일 수 | 감소 목표 |
| 재작업률 | 병합 실패·계약 불일치에 의한 추가 수정 횟수 | 감소 목표 |

**주의:** CLI 구독제는 토큰당 현금 결제 비용이 별도 계량되지 않을 수 있다. 이 경우 '실제 청구비용 미확인'으로 표기하고 `tokens`, `quota usage`, `latency`를 보조 지표로 기록한다. **토큰 개수 = 사용자 결제 비용**이라고 허위 계산하지 않는다.

# 2. 사용자 역할과 전체 경험

## 2.1 페르소나

1. **개인 개발자:** 기존 저장소를 연결하고 AI로 기능을 구현한다. 로컬 CLI 환경을 선호한다.
2. **1인 빌더:** 기술적 요구를 잘 몰라도 기능 명세·미리보기·최종 결과를 확인하고 싶다.
3. **소규모 팀 관리자:** 비용, GitHub 접근권한, 승인 정책, 감사 추적이 필요하다.
4. **서비스 운영자:** 사용량 이상, 결제, 실패율, 스킬 공급망 및 정책 위반을 모니터링한다.

## 2.2 대표 사용자 여정 A — 로컬 개발

1. 웹 가입 또는 로그인 → 이용약관·개인정보 안내 확인.
2. 새 프로젝트 → `Local Workspace` 선택 → 웹에서 페어링 코드 발급.
3. 로컬 사용자가 공식 설치 경로의 ASO Runner를 설치·실행하고 페어링 코드를 입력한다.
4. 러너가 명시적으로 허용한 프로젝트 디렉터리를 선택한다. **브라우저가 경로를 강제로 열지 않는다.**
5. 러너에서 설치된 CLI의 실행 가능 여부를 확인한다. 사용자에게 각 CLI의 공식 로그인/인증 상태 확인 방법을 안내한다.
6. 웹에서 자연어 요구 입력 → 고도화된 요구사항과 가정·수용기준 표시.
7. 필요한 승인사항(예: 파일 변경 범위, 외부 API 사용, 네트워크)을 사용자가 확인한다.
8. 서버가 비밀 없는 실행 계약을 러너에 전달한다 → 러너가 지정된 디렉터리에서 실행.
9. 웹 UI는 상태/로그 요약/테스트 결과를 실시간 표시하고, 위험 명령은 사용자 승인을 요구한다.
10. 검증 완료 시 변경 파일·diff·테스트·실행시간·측정 가능한 사용량을 보여준다.

## 2.3 대표 사용자 여정 B — GitHub + BYOK 클라우드 작업

1. GitHub App 설치 → 사용자가 선택한 저장소만 연결.
2. 사용자는 본인 소유의 허용된 모델 API 키를 암호화된 BYOK Vault에 등록한다.
3. 프로젝트 생성 시 대상 브랜치와 실행 정책 선택.
4. 서버는 대상 저장소에 대한 최소권한 GitHub installation token을 임시 발급받아 격리된 런타임에서 checkout.
5. API 키는 필요한 러너에만 단기 주입. 실행 완료 후 파기.
6. 작업 계획·구현·테스트 → PR 초안 생성 → 사용자가 리뷰·승인·머지.
7. 비용 화면에는 ASO 구독 비용, 클라우드 리소스 비용, 외부 모델 비용을 분리 표시한다.

## 2.4 대표 사용자 여정 C — 구독 연결

- **기본:** 원격 SaaS가 구독 계정으로 직접 추론하는 기능은 제공하지 않는다.
- **로컬:** 사용자 본인의 컴퓨터에서 공식 CLI를 본인 인증으로 실행하는 기능을 별도 모드로 제공할 수 있다. 특정 제공사의 약관과 허용 방식 검토가 선행되어야 한다.
- **OpenAI 승인 파트너:** 승인된 Sign in with ChatGPT 연동과 별도 사용량 권한을 얻은 경우에만 `PARTNER_OAUTH`를 노출한다.
- **불가/미승인:** API 키(BYOK), 지원되는 직접 과금 연결, 또는 지원 불가 안내로 대체한다.

## 2.5 역할과 권한

| 역할 | 프로젝트 보기 | 실행 | 비밀 관리 | GitHub 설정 | 사용자 초대 | 요금제 |
|---|---|---|---|---|---|---|
| owner | 허용 | 허용 | 관리 | 관리 | 관리 | 관리 |
| admin | 허용 | 허용 | 정책 내 관리 | 관리 | 관리 | 조회 |
| developer | 허용 | 허용 | 본인 키만 | 연결 요청 | 불가 | 조회 |
| viewer | 허용 | 불가 | 불가 | 불가 | 불가 | 조회 |
| runner device | 특정 작업 계약만 | 허가된 작업만 | 서버 비밀 조회 불가 | 불가 | 불가 | 불가 |

- 모든 API는 사용자 식별 + 워크스페이스 멤버십 + 리소스 소유권을 모두 확인한다.
- 로컬 러너의 디바이스 권한은 사람 계정 권한의 완전한 대체물이 아니다.

# 3. 구독·API·CLI 연결 정책과 기능 게이트

> **중요:** 제품 설계에서 가장 높은 사업 리스크. 2026-11-04에 확인한 공식 문서를 기준으로 작성했으며, 실제 출시 전 최신 약관과 계약을 재검토한다. '기술적으로 가능'과 '제공사가 상업적 중계 서비스를 허용'은 다른 문제다. 법률 자문을 대체하지 않는다.

## 3.1 연결 모드 정의

| 모드 | 값 | 인증 위치 | 추론 비용 부담 | MVP 상태 |
|---|---|---|---|---|
| 로컬 공식 CLI | `LOCAL_NATIVE_CLI` | 사용자 기기·공식 CLI | 해당 제공사 계정/요금제 조건 | Codex 우선; Claude/Gemini 정책 검토 후 |
| 사용자 API 키 | `USER_API_KEY` | 서버 암호화 보관 또는 로컬 키스토어 | 사용자 개인 API 계정 | 기본 GA 경로 |
| 승인된 OAuth 사용량 위임 | `PARTNER_OAUTH_APPROVED` | 제공사 공식 OAuth/PKCE | 제공사가 승인한 구독/크레딧 | 기본 OFF |
| 관리자 관리형 API | `ORG_API_KEY` | 기업 소유 비밀 저장소 | 조직 API 계약 | Team 단계 |

금지: `COOKIE_IMPORT`, `BROWSER_SESSION_EXPORT`, `HARVEST_OAUTH`, `HIDDEN_TOKEN_PROXY`, `RESELL_PERSONAL_SUBSCRIPTION`.

## 3.2 제공사별 기능 매트릭스

| 제공사 | BYOK API | 로컬 네이티브 | 외부 SaaS 구독 연동 | 기본 UI 정책 |
|---|---|---|---|---|
| OpenAI/Codex | 공식 API/SDK | 사용자의 Codex CLI 인증 가능 | Sign in with ChatGPT는 선정된 상업 파트너에 제한적으로 제공. 승인 및 범위 확인 필수 | `BYOK`/`Local` 노출, `Partner` OFF |
| Anthropic/Claude Code | 공식 Anthropic API/Agent SDK | 수정되지 않은 Claude Code에서 본인 계정 로그인 경로가 존재. 서비스 제공 조건·상업 약관 준수 필요 | 제3자 앱의 Claude.ai 로그인 또는 구독 자격증명 대리 중계 금지 | `BYOK` 기본, 로컬 기능 게이트 |
| Google/Gemini | AI Studio 또는 Vertex AI API | 공식 Gemini CLI 자동화는 지원하나 제3자가 CLI OAuth 인증을 피기백/수확하는 행위는 금지 | Gemini CLI OAuth를 외부 추론 백엔드용으로 재사용 금지 | `BYOK` 기본, 로컬 유료 서비스용 OAuth 우회 금지 |

**구현 기준:** 제공사 문서·상업 계약에 확정되지 않은 기능을 '지원'이라고 표기하지 않는다. Gemini의 유저 계정 CLI가 일회성 headless 명령을 실행할 수 있다는 사실만으로 상업용 SaaS의 원격 모델 중계가 허용되었다고 추론하지 않는다.

## 3.3 ProviderConnection 상태

```ts
type ConnectionMode = 'LOCAL_NATIVE_CLI' | 'USER_API_KEY' | 'ORG_API_KEY' | 'PARTNER_OAUTH_APPROVED';
type ConnectionStatus = 'not_configured' | 'connecting' | 'connected' | 'needs_action' | 'expired' | 'revoked' | 'disabled_by_policy';

type ProviderConnectionView = {
  id: string;
  provider: 'openai' | 'anthropic' | 'google';
  mode: ConnectionMode;
  status: ConnectionStatus;
  displayName: string;
  capabilities: Array<'plan' | 'code' | 'review' | 'tools' | 'structured_output'>;
  billingOwner: 'user' | 'organization' | 'partner_plan';
  estimatedCostVisible: boolean;
  legalGate: 'approved' | 'pending' | 'blocked';
  lastHealthCheckAt: string | null;
};
```

`ProviderConnectionView`에는 토큰, API 키, 계정 비밀번호를 절대 담지 않는다.

## 3.4 기능 플래그

```json
{
  "providers": {
    "openai": { "byokApi": true, "localNative": true, "partnerOAuth": false },
    "anthropic": { "byokApi": true, "localNative": false, "partnerOAuth": false },
    "google": { "byokApi": true, "localNative": false, "partnerOAuth": false }
  },
  "execution": { "localRunner": true, "cloudSandbox": false, "parallelDAG": false },
  "commercial": { "billingEnabled": false, "teamsEnabled": false },
  "skills": { "eccSpecialist": false, "externalSkillInstall": false }
}
```

- Feature flag는 프론트엔드 표시만 바꾸는 값이 아니다. **서버가 실제로 기능 게이트를 검사**한다.
- 플래그는 배포환경/워크스페이스/사용자 수준으로 단계적으로 노출할 수 있다.
- 제공사 연동 준비가 안 되어도 `MockProvider`로 E2E를 수행하고 BYOK 경로로 정상 운영할 수 있어야 한다.

## 3.5 연결 실패 시 UX

- 자격증명 만료 → `needs_action`, 재인증 안내. 자동 무한 재시도 금지.
- 구독 OAuth 승인 미획득 → 연결 버튼 숨김 또는 `신청 대기 중` 표시, API 키 대안 제공.
- 제공사 정책 위반 의심 → 즉시 해당 커넥터 비활성화 및 감사 기록.
- API rate-limit → 점진적 재시도, 예산·지연 안내, 임의 모델/과금 경로 전환 금지.
- 사용량 측정 불가 → `비용 미확인`, 추정 근거와 범위 표시. 임의 0원 표기 금지.

# 4. 시스템 아키텍처와 기술 스택

## 4.1 큰 구조

```mermaid
flowchart TD
  B[Browser / Next.js] --> W[Web BFF / Auth]
  W --> A[Fastify API]
  A --> DB[(PostgreSQL)]
  A --> Q[(Redis + BullMQ)]
  A --> ES[Event Stream SSE]
  A --> GH[GitHub App]
  A --> VA[Secret Vault]
  Q --> O[ASO Orchestrator Worker]
  O --> SR[Skill Registry + Policy]
  O --> DP[DAG Planner / Scheduler]
  DP --> XR[Execution Router]
  XR --> LR[Local Runner Agent]
  XR --> CS[Cloud Sandbox Worker]
  LR --> NC[Native CLI / User Workspace]
  CS --> PA[Provider API Adapters]
  NC --> EV[Tests / Verification]
  PA --> EV
  EV --> DB
  EV --> ES
  ES --> B
```

### 독립된 책임

- **Web:** 화면, 입력 검증, 접근성, 서버 상태 UI. 위험 명령을 직접 수행하지 않는다.
- **BFF:** HTTP-only 세션 처리, 서버 API 프록시, CSRF 및 사용자 컨텍스트 전달.
- **API:** 프로젝트/연결/작업/승인/RBAC/서명·사용량/감사 관리.
- **Orchestrator:** 요구사항 → 수용기준 → 계획 → 스킬 결정 → 실행 작업 생성.
- **Scheduler:** DAG, 의존성, 동시성, retry/lease, 상태 변경.
- **Execution Router:** runtime과 provider capability에 맞춰 실행 타겟 선택.
- **Local Runner:** 사용자 기기에서 명시적으로 허용된 workspace에서만 작업.
- **Cloud Sandbox:** 격리된 임시 컨테이너 내에서 저장소 수정·테스트.
- **Event Store:** 재연결·감사·SSE 재전송 가능한 이벤트 단일 원천.
- **Vault:** API 키·GitHub 설치 토큰 등 비밀 최소 보관. 로컬 CLI 인증 캐시 수집 금지.

## 4.2 기술 선택 (MVP 기본)

| 구성 | 기술 | 선택 이유 |
|---|---|---|
| 웹 | Next.js App Router + TypeScript + React | 프로젝트·상태 페이지, 서버 컴포넌트 |
| UI | Tailwind CSS + 접근성 중심 컴포넌트 | 빠른 MVP와 일관된 상태 표기 |
| API | Fastify + Zod + OpenAPI | 검증된 계약, 명시적 런타임 |
| DB | PostgreSQL + Drizzle ORM/SQL migration | 트랜잭션·복잡한 상태/로그 |
| Job Queue | Redis + BullMQ | 재시도·지연·작업 큐 분리 |
| 이벤트 | PostgreSQL append-only events + SSE | replay 지원, 구현 단순성 |
| 로컬 러너 | Node.js LTS + TypeScript | 공통 타입과 CLI 스폰 |
| 클라우드 실행 | ephemeral OCI containers (Docker/Kubernetes 등) | 파일/프로세스 격리 |
| Storage | S3-compatible private object storage | artifact/diff/report 저장 |
| Git | GitHub App + Git worktrees | 최소 권한/분리된 작업 |
| Auth | 검증된 OIDC/OAuth 인증 서비스 + DB-backed session | 패스워드 직접 구축 회피 |
| 테스트 | Vitest + Playwright + Testcontainers + 보안 검사 | 유닛·통합·브라우저 자동화 |
| 관측 | OpenTelemetry + structured logs + metrics | 실행 단계별 병목 추적 |
| 결제(후속) | 국내/해외 대상에 맞는 PSP | Stripe 지원 여부·정산·세금 사전 확인 |

**버전 원칙:** 문서의 기술명은 제안이다. 구현 시 해당 날짜의 안정 버전과 호환성을 확인하고 `pnpm-lock.yaml`, 런타임 버전 파일에 고정한다. 테스트 없이 최신 메이저로 일괄 업그레이드하지 않는다.

## 4.3 아키텍처 결정 기록(ADR)

- **ADR-001:** 오케스트레이터는 웹 UI와 분리된 서버 패키지로 구현한다. 향후 CLI와 재사용.
- **ADR-002:** 웹 서버에서 사용자 셸 명령을 실행하지 않는다. 실행은 Local Runner/Cloud Sandbox만 수행.
- **ADR-003:** 초기 실시간 피드는 SSE. 양방향 장기 러너 연결은 outbound WebSocket으로 분리.
- **ADR-004:** DB가 실행 상태의 source of truth이며 Redis는 큐/캐시. Redis 장애로 실행 이력을 잃지 않는다.
- **ADR-005:** GitHub는 개인 OAuth 앱보다 최소 저장소 권한이 가능한 GitHub App 우선.
- **ADR-006:** 모든 외부 AI 연결은 인증·허용 경로·과금 주체가 독립적으로 정의된다.
- **ADR-007:** ASO는 ECC/Superpowers의 대체 상위 관리자다. 스킬 내부의 독자 무한 실행 루프를 허용하지 않는다.
- **ADR-008:** Local Runner는 사용자 파일에 대한 권한 경계이며, 웹은 실행 계약만 전달한다.
- **ADR-009:** 실행 비용과 구독 청구는 서로 다른 ledger로 운영한다.
- **ADR-010:** 모델/스킬 후보의 인덱스는 서버에서 관리하되, 원본 스킬은 검증 후 필요 시 로딩한다.

# 5. 모노레포 및 책임 경계

```text
aso-web/
├── AGENTS.md                              # Codex 및 공통 에이전트 안내
├── CLAUDE.md                              # Claude Code용 얇은 안내
├── GEMINI.md                              # Gemini CLI용 얇은 안내
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── .env.example
├── .github/
│   └── workflows/{ci.yml,security.yml,release.yml}
├── apps/
│   ├── web/                               # Next.js UI
│   │   ├── app/(marketing)/
│   │   ├── app/(auth)/
│   │   ├── app/(workspace)/w/[workspaceId]/
│   │   ├── app/api/                       # BFF only
│   │   ├── components/{layout,projects,runs,providers,skills,billing}/
│   │   ├── hooks/
│   │   └── lib/
│   ├── api/                               # Fastify REST + SSE + runner websocket
│   │   └── src/{routes,handlers,services,middleware,events,security}/
│   ├── worker/                            # BullMQ consumers
│   │   └── src/{jobs,orchestrator,scheduler,recovery}/
│   └── local-runner/                      # 사용자 기기에서 실행
│       └── src/{cli,pairing,transport,workspace,policy,executors,health}/
├── packages/
│   ├── contracts/                         # Zod DTO/Event/Run schema
│   ├── database/                          # Drizzle schema, migrations, RLS
│   ├── aso-core/                          # intent / plan / routing / policy
│   ├── skill-registry/                    # skill metadata, lock, provenance
│   ├── scheduler/                         # DAG, leases, state machine
│   ├── provider-adapters/                 # mock/openai/anthropic/google
│   ├── execution-protocol/                # Runner messages + signing
│   ├── git-integration/                   # GitHub App, branches, PR
│   ├── observability/                     # telemetry & usage
│   ├── security/                          # secret redaction, command policy
│   ├── billing/                           # subscription + credits (future)
│   ├── ui/                                # Design tokens/components
│   └── testing/                           # fixtures, mock providers
├── skills/
│   ├── registry.json
│   ├── skills.lock.json
│   ├── policy.yaml
│   ├── core/                               # 고정된 내부 스킬 메타데이터
│   └── external/                           # 승인/검증 후 설치되는 스킬
├── config/
│   ├── aso.yaml
│   ├── provider-policy.yaml
│   ├── capability-matrix.yaml
│   └── feature-flags.json
├── infra/
│   ├── compose.yaml
│   ├── terraform/                          # 상용 배포 후속
│   ├── k8s/                                # 선택 사항
│   └── dashboards/
├── docs/
│   ├── ASO_WEB_APP_SPEC.md                 # 이 문서 배치 권장
│   ├── ASO_ENGINE_SPEC.md                  # 기존 CLI 엔진 명세서(있으면 링크)
│   ├── adr/
│   ├── security/
│   ├── runbooks/
│   ├── api/openapi.yaml
│   └── qa/
├── tests/
│   ├── e2e/
│   ├── integration/
│   ├── security/
│   ├── contracts/
│   └── benchmarks/{fixtures,baselines,reports}/
└── scripts/{setup,seed,lint-spec,benchmark,verify}.ts
```

## 5.1 패키지 의존 방향

```text
contracts, security, observability       <- 모든 모듈에서 참조 가능
aso-core -> contracts + skill-registry + provider-adapters (인터페이스만)
scheduler -> contracts + database
api -> core + scheduler + database + security
worker -> core + scheduler + provider-adapters + database
local-runner -> execution-protocol + security + contracts
web -> contracts + ui (백엔드 내부 코드는 직접 import 금지)
```

`apps/web`에서 `apps/worker`를 직접 import하거나, `packages/aso-core`가 Fastify/Next.js에 종속되는 구조는 금지한다.

## 5.2 기본 환경설정

```dotenv
# apps/api + worker (예시. 실제 키 값을 커밋하지 않는다)
NODE_ENV=development
DATABASE_URL=postgresql://aso:aso_dev@localhost:5432/aso_dev
REDIS_URL=redis://localhost:6379
PUBLIC_APP_URL=http://localhost:3000
API_ORIGIN=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
SESSION_SECRET=replace-with-random-value-at-least-32-bytes
SECRETS_ENCRYPTION_KEY=base64-encoded-32-byte-data-key
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_BUCKET=aso-artifacts
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_BASE64=
GITHUB_WEBHOOK_SECRET=
ENABLE_CLOUD_SANDBOX=false
ENABLE_PARTNER_OAUTH=false
ENABLE_BILLING=false
ENABLE_ECC_SPECIALIST=false
OTEL_EXPORTER_OTLP_ENDPOINT=
```

- `.env.example`에는 안전한 placeholder만 포함한다.
- 프로덕션에서는 환경변수만으로 영구 키를 저장하지 말고 KMS/secret manager와 rotation을 사용한다.
- 개발 기본 계정과 비밀번호는 개발용 격리 DB에만 존재해야 한다.

# 6. UX 화면·상태·동선 상세

## 6.1 정보 구조

```text
/                                   랜딩 / 제품 소개
/login                              로그인
/onboarding                         사용 목적 + 실행 위치 선택
/onboarding/connect                 GitHub / AI 연결
/onboarding/runner                  로컬 러너 페어링
/w/[workspaceId]                    대시보드
/w/[workspaceId]/projects           프로젝트 목록
/w/[workspaceId]/projects/new       새 프로젝트 마법사
/w/[workspaceId]/projects/[id]      프로젝트 개요 + 히스토리
/w/[workspaceId]/runs/[runId]       작업 진행 현황
/w/[workspaceId]/runs/[runId]/plan  요구사항·계획·승인
/w/[workspaceId]/runs/[runId]/diff  변경사항·코드 리뷰
/w/[workspaceId]/runs/[runId]/tests 검증·테스트
/w/[workspaceId]/connections        AI/GitHub 연결 관리
/w/[workspaceId]/runners            기기·샌드박스 상태
/w/[workspaceId]/skills             스킬 카탈로그·활성화
/w/[workspaceId]/usage              토큰·비용·실행시간
/w/[workspaceId]/benchmarks         비교 실험 및 품질
/w/[workspaceId]/settings           팀·권한·정책·보안
/w/[workspaceId]/billing            요금제/결제(기능 게이트)
```

## 6.2 공통 디자인 요구사항

- 반응형: desktop 1440px 기준 3열(사이드바/메인/디테일), tablet 2열, mobile 1열.
- 사용자에게 필수 항목은 **상태, 진행 중인 단계, 승인 여부, 변경 코드, 테스트 결과, 측정 가능한 비용**이다.
- WCAG 2.2 AA 목표: 키보드 접근, 포커스 링, 버튼 레이블, 명도 대비, 상태는 색상만으로 표시하지 않음.
- 서버 실행중이라는 이유로 브라우저가 꺼졌을 때 작업 상태가 소실되면 안 된다.
- 모든 긴 작업에는 취소·재시도 및 기록 조회 경로를 제공한다.
- 실제 미확인 비용은 `— (측정 불가)`로 표시. 추정값은 `예상` 배지와 계산 근거.
- 로그인/연결되지 않은 공급사를 마치 연결된 것처럼 꾸미지 않는다.

## 6.3 화면 W01 — 랜딩

- 헤더: 제품명 ASO Web, 기능, 가격, GitHub, 시작하기.
- 히어로: '무엇을 만들지만 말하세요. AI·스킬·실행순서는 ASO가 결정합니다.'
- 5단계 데모: 요구 고도화 → 계획 → 스킬 → 병렬 실행 → 검증.
- 두 가지 실행 경로: 내 PC에서 실행 / 안전한 클라우드에서 실행.
- 제공사 연결은 지원 중·베타·준비 중을 명확히 구분.
- 경쟁사 비교의 확정적 성능 우월 주장 금지.

## 6.4 화면 W02 — 온보딩

**Step 1 사용 목적:** 기존 저장소 개선 / 새 앱 만들기 / 코드 리뷰·테스트.

**Step 2 실행 위치:** Local(기본 추천) / Cloud(기능 플래그가 켜진 경우).

**Step 3 연결:** GitHub App / AI API Key / 지원되는 공식 로컬 CLI.

**Step 4 준비도 검사:** runner 온라인, 대상 저장소 접근, 인증 경로, 권한, 사용량 한도.

- 입력이 없거나 실패한 항목만 다시 요청.
- 인증 방식마다 요금 주체와 데이터 전송 범위를 사전 설명.
- 완수 후 워크스페이스 대시보드로 이동.

## 6.5 화면 W03 — 대시보드

- 상단: `새 작업`, `새 프로젝트`, 이번 주 성공 실행 수, 평균 시간, 비용/사용량.
- 최근 프로젝트 카드: 이름, 마지막 실행, 연결 저장소, 기본 모델, 로컬/클라우드.
- 실행 큐: running, awaiting approval, failed, completed.
- `연결 필요`, `러너 오프라인`, `API quota 초과` 안내.
- 모바일은 마지막 실행 확인/승인 중심으로 축소.

## 6.6 화면 W04 — 프로젝트 생성

1. 프로젝트 이름 및 설명.
2. 소스: `GitHub repository`, `로컬 폴더`, `빈 프로젝트`.
3. 실행 위치와 선호 모델 (`auto` 기본).
4. 권한: 파일 쓰기, 테스트, 네트워크, Git push/PR을 개별 승인.
5. 최대 시간/예산 설정 및 초과 시 중지 방식 선택.
6. 마지막 단계에서 전체 설정 요약 후 생성.

초기 MVP에서는 `GitHub` 또는 `로컬 폴더`를 우선 구현하고, 빈 프로젝트 템플릿은 다음 단계로 미뤄도 된다.

## 6.7 화면 W05 — 실행 입력/요구사항 고도화

- 좌측: 사용자 원문, 첨부 링크/파일, 제약.
- 중앙: 자동 추출한 **목표, 범위, 기술 제약, 합리적 가정, 우선순위, 완료 기준**.
- 우측: 난이도 FAST/STANDARD/DEEP, 예상 스킬, 예산 및 리스크.
- 버튼: `계획 승인`, `요구사항 수정`, `중요 결정에 답변`, `취소`.
- 기본 규칙: 질문 남발 금지. 결제/데이터 삭제/법적 경계/불가역한 결정 등에만 질문을 필수화.

## 6.8 화면 W06 — 계획 및 스킬 선택

- 의존성 DAG: 완료/실행중/대기/차단 상태.
- 각 task 카드: 이름, 수용 기준, 선택 모델, 선택 스킬, 파일 영향, 예상 예산.
- `왜 선택되었는가?` 설명: 스킬의 capabilities 및 비용/위험 점수 기반.
- `자동`, `단일 실행`, `병렬 최대 N개` 선택. UI 변경은 서버 정책 내에서만 허용.
- ECC 전문 스킬은 기본 숨김/선택 활성화. 과도한 전역 훅 활성화 금지.

## 6.9 화면 W07 — 실행 진행 현황

- 좌측: 단계 타임라인 `요구 고도화/기획/스킬/구현/검증`.
- 중앙: 실행 중인 태스크·파일·진행 상태, 중요 이벤트만 기본 노출.
- 우측: 러너 연결, 모델 상태, 누적 시간, 측정 가능한 token/quota 사용량, 권한 요청.
- `전체 로그`는 펼침으로 제공하되 비밀 redaction 필수.
- SSE 끊김 시 마지막 `event_id`부터 재연결, 이벤트 재생.
- `일시정지`, `취소` 버튼은 실제 백엔드에 전파되어야 하며 버튼만 상태를 바꿔서는 안 된다.

## 6.10 화면 W08 — 승인 다이얼로그

- 요청한 명령/작업의 **목적, 파일·자원 범위, 위험, 요청한 에이전트, 만료시간**을 보여준다.
- 버튼 `이번 한 번 허용`, `거절`, 조직 정책이 허용하는 경우 `동일 종류 제한적 허용`.
- 예: `npm test`는 사전 허용 대상일 수 있으나, `rm -rf`, 배포, DB migration, 외부 전송, 권한 변경은 별도 심사.
- 권한은 서명된 `approval_id + task_id + command_hash`와 결합한다. 다른 명령에 재사용 불가.
- 사용자 응답이 없으면 안전하게 만료/차단 처리.

## 6.11 화면 W09 — 결과물·diff·테스트

- 최종 상태 `completed / failed / cancelled / partial` 중 명확히 하나.
- Summary: 구현 기능 / 누락 기능 / 확인이 필요한 내용 / 변경 파일 / 테스트 결과.
- Diff 뷰: 파일별 변경량, 위험 파일, 코드 보기, 다운로드 가능한 patch (권한 있는 사용자만).
- 테스트 뷰: 명령, 시작/종료, exit code, 실패 원인, 재현 방법, 관련 로그 링크.
- GitHub 연결 시 `PR 생성`은 사용자가 허용한 경우만 가능.
- 실패한 테스트가 있는 경우 '완료' 뱃지 금지; `partial` 또는 `failed` 및 근거 표기.

## 6.12 화면 W10 — Connections

- GitHub: App 설치, 접근 가능한 저장소, 권한, 연결 해제.
- OpenAI/Anthropic/Google 카드: `연결 방식`, `연결 상태`, `비용 부담 주체`, `마지막 확인`, `연결 해제`.
- BYOK 입력: 서버로 TLS 제출 → Vault 암호화 저장 → 화면에서 평문 다시 보여주지 않음.
- 로컬 CLI: CLI 이름·버전·상태만 표시. 비밀번호/토큰 수집하지 않음.
- 미승인 파트너 OAuth는 클릭 가능한 연결 버튼을 제공하지 않는다.

## 6.13 화면 W11 — Skills

- 스킬 카탈로그: 이름, 원본, 버전, 라이선스, 위험 등급, 기능, 적용되는 task 유형.
- `core`, `specialist`, `external`, `disabled` 구분.
- 선택 스킬 이유 및 관련 테스트 표시.
- 외부 스킬 설치는 서버에서 임의 실행하지 않고 승인·해시·권한·샌드박스 검증 후 허용.
- ECC의 planner/hook/memory를 기본 비활성화하여 Superpowers/claude-mem과 충돌 방지.

## 6.14 화면 W12 — Usage / Benchmark / Settings / Billing

- Usage: 요청별 모델 입력/출력/캐시 읽기·쓰기 토큰, wall-time, 러너비용, API 예상비용, 재작업 횟수.
- Benchmark: baseline/whole-skills/adaptive 3군 비교, 독립 평가 결과 및 신뢰구간.
- Settings: 멤버, API 키, 데이터 보관, 외부 네트워크, 실행 승인 정책, 감사로그.
- Billing: Free/Pro/Team/Cloud Credits, 구독 비용과 외부 AI 서비스 비용 명확히 구분.
- 운영자가 특정 워크스페이스의 비밀을 평문으로 볼 수 없도록 설계.


---

# 7. 도메인 모델 및 데이터베이스 설계

## 7.1 공통 식별자 및 시간 규약

- 모든 공개 리소스 ID는 UUID v7 또는 ULID 중 하나를 결정해 일관되게 사용. 내부 DB PK는 UUID.
- API 시간은 ISO 8601 UTC, UI는 사용자 timezone으로 변환.
- 멱등성 키는 작업 요청 단위로 고유해야 한다(`workspace_id, idempotency_key`).
- 삭제: 사용자의 복구 가능 데이터는 `deleted_at`; 비밀/세션 토큰은 즉시 파기. 데이터 보존 기간은 정책으로 관리.
- 저장소 연결·작업·비용·감사 데이터는 반드시 `workspace_id`로 격리.
- 개인정보 목적 외 수집과 무제한 원시 프롬프트 저장 금지.

## 7.2 주요 엔티티

| 엔티티 | 목적 | 핵심 필드 |
|---|---|---|
| `users` | 사용자 | id, email, display_name, created_at |
| `workspaces` | 테넌트 | id, name, owner_id, plan, retention_days |
| `workspace_members` | RBAC | workspace_id, user_id, role, status |
| `projects` | 개발 프로젝트 | workspace_id, source_type, repo_url, default_runtime |
| `github_installations` | GitHub App 연결 | installation_id, owner, permissions metadata |
| `provider_connections` | 모델 연결 | provider, mode, status, secret_ref, policy_gate |
| `runner_devices` | Local Runner | device_id, public_key, status, last_seen_at |
| `runner_workspaces` | 허용된 로컬 폴더 | device_id, project_id, path_fingerprint, permissions |
| `runner_pairing_codes` | 1회 페어링 | code_hash, expires_at, consumed_at |
| `runs` | 사용자 1회 작업 요청 | request, mode, state, budget, runtime, plan_id |
| `run_requirements` | 고도화 결과 | goals, assumptions, constraints, acceptance_criteria |
| `run_plans` | 계획 버전 | version, plan_json, approval_status |
| `run_tasks` | DAG 노드 | deps, state, assigned_provider, lease, attempt |
| `run_events` | UI/감사 이벤트 | run_id, sequence, event_type, payload, recorded_at |
| `approvals` | 위험 작업 승인 | task_id, command_hash, scope, expires_at, decision |
| `skill_registry` | 스킬 카탈로그 | provenance, version, digest, capabilities, risk |
| `run_skill_bindings` | 선택한 스킬 | run_id, task_id, skill_id, reason, load_cost |
| `artifacts` | diff/테스트/프리뷰 | run_id, storage_key, type, sha256, retention |
| `usage_ledger` | 실제 사용량 | provider, mode, tokens, measured_cost, confidence |
| `subscription_accounts` | ASO SaaS 결제 | workspace_id, ps_customer_ref, plan, status |
| `billing_ledger` | ASO의 자체 이용료 | workspace_id, units, amount, currency, source |
| `audit_logs` | 변경/보안 기록 | actor, action, resource, metadata, created_at |
| `benchmark_cases/results` | 성능 실험 | fixture, variant, outcomes, cost, duration |
| `idempotency_records` | 중복 실행 방지 | workspace_id, key, request_hash, response_ref |

## 7.3 핵심 ERD

```mermaid
erDiagram
  USERS ||--o{ WORKSPACE_MEMBERS : joins
  WORKSPACES ||--o{ WORKSPACE_MEMBERS : has
  WORKSPACES ||--o{ PROJECTS : owns
  WORKSPACES ||--o{ PROVIDER_CONNECTIONS : configures
  WORKSPACES ||--o{ RUNNER_DEVICES : pairs
  PROJECTS ||--o{ RUNS : executes
  RUNS ||--|| RUN_REQUIREMENTS : refines
  RUNS ||--o{ RUN_PLANS : plans
  RUNS ||--o{ RUN_TASKS : includes
  RUNS ||--o{ RUN_EVENTS : streams
  RUNS ||--o{ ARTIFACTS : produces
  RUNS ||--o{ USAGE_LEDGER : measures
  RUN_TASKS ||--o{ APPROVALS : requires
  RUN_TASKS ||--o{ RUN_SKILL_BINDINGS : selects
  SKILL_REGISTRY ||--o{ RUN_SKILL_BINDINGS : binds
```

## 7.4 SQL 기본 스키마(첫 마이그레이션의 기준)

> 아래 DDL은 ORM 생성 전에 **데이터 계약을 고정하기 위한 기준 예시**다. 실제 migration에서는 일관된 UUID 생성 방법과 확장 설치·인덱스·RLS를 테스트한 후 반영한다. JSON 구조는 Zod 스키마로 별도 검증한다.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','developer','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('local','github','new')),
  repository_ref TEXT,
  default_runtime TEXT NOT NULL CHECK (default_runtime IN ('local','cloud')),
  default_provider TEXT NOT NULL DEFAULT 'auto',
  execution_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_projects_workspace ON projects(workspace_id, created_at DESC);

CREATE TABLE provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google')),
  mode TEXT NOT NULL CHECK (mode IN ('LOCAL_NATIVE_CLI','USER_API_KEY','ORG_API_KEY','PARTNER_OAUTH_APPROVED')),
  status TEXT NOT NULL DEFAULT 'not_configured',
  secret_ref TEXT,
  billing_owner TEXT NOT NULL,
  legal_gate TEXT NOT NULL DEFAULT 'pending',
  policy_version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_health_check_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_provider_connections_workspace ON provider_connections(workspace_id);

CREATE TABLE runner_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','revoked')),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_runner_devices_workspace ON runner_devices(workspace_id);

CREATE TABLE runner_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiated_by UUID NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  created_by UUID NOT NULL REFERENCES users(id),
  raw_request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  execution_mode TEXT NOT NULL DEFAULT 'auto',
  runtime TEXT NOT NULL CHECK (runtime IN ('local','cloud')),
  provider_preference TEXT NOT NULL DEFAULT 'auto',
  budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_runs_workspace_created ON runs(workspace_id, created_at DESC);
CREATE INDEX idx_runs_project_status ON runs(project_id, status);

CREATE TABLE run_requirements (
  run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  refined_spec JSONB NOT NULL,
  spec_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  plan_json JSONB NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, version)
);

CREATE TABLE run_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  capability_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_provider TEXT,
  assigned_runner_id UUID REFERENCES runner_devices(id),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  result JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(run_id, task_key)
);
CREATE INDEX idx_run_tasks_run_state ON run_tasks(run_id, state);

CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, sequence)
);
CREATE INDEX idx_run_events_replay ON run_events(run_id, sequence);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES run_tasks(id),
  requested_by TEXT NOT NULL,
  command_digest TEXT NOT NULL,
  scope JSONB NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE skill_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  license_id TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'unreviewed',
  enabled BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(canonical_name, source_commit)
);

CREATE TABLE run_skill_bindings (
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skill_registry(id),
  selection_reason TEXT NOT NULL,
  PRIMARY KEY(run_id, task_id, skill_id)
);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ
);

CREATE TABLE usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES run_tasks(id),
  provider TEXT NOT NULL,
  model TEXT,
  connection_mode TEXT NOT NULL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cached_input_tokens BIGINT,
  cache_write_tokens BIGINT,
  duration_ms BIGINT,
  measured_cost_usd NUMERIC(18, 8),
  cost_confidence TEXT NOT NULL DEFAULT 'unavailable',
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(workspace_id, idempotency_key)
);
```

## 7.5 SQL 마이그레이션 추가 요구

- 실제 `migrations/`에서 위 스키마에 대응하는 모든 테이블과 `unique`, `foreign key`, `not null`, `indexes`, `check`를 보장한다.
- `runner_workspaces`, `github_installations`, `billing_ledger`, `subscription_accounts`, `benchmark_cases`, `benchmark_results`는 관련 Phase에서 추가한다.
- `ON DELETE CASCADE`는 부모와 자식의 보존 의무를 검토해 적용; 원시 감사로그 삭제 정책은 별도.
- DB 사용자별 권한 분리: API DB role, migration role, read-only analytics role.
- 다중 테넌트는 모든 쿼리에 워크스페이스 필터 필수. 가능하면 PostgreSQL RLS 추가하되 `SET LOCAL` 트랜잭션 사용, 풀링 누수 방지.
- `runs.workspace_id = projects.workspace_id` 같은 교차 테넌트 불변식은 서비스 계층+DB 제약(복합 FK 등)으로 검사한다.
- 이벤트 시퀀스는 DB 트랜잭션 내에서 per-run 증가값을 할당한다(단순 `MAX(sequence)+1` 레이스 금지).
- 이벤트와 상태 변경은 동일 트랜잭션으로 commit하고, queue publish는 outbox 패턴으로 전달한다.

## 7.6 데이터 보존 및 삭제

| 데이터 | 초기 보존 제안 | 사용자가 삭제 요청 시 |
|---|---|---|
| 파일 diff / 로그 | 30일 | 개인정보·비밀 삭제 정책에 따라 즉시 폐기 시작 |
| 실행 요약/메타데이터 | 90일 | 법적 보존 필요 여부 확인 후 삭제 |
| API 키 | 활성 연결 동안 | 연결 해제 즉시 키 및 암호화 자료 파기 |
| 페어링 코드 | 10분 | 성공/만료 즉시 폐기 |
| 원시 프롬프트 | 사용자가 설정한 기간 | 검색 인덱스 포함 삭제 |
| 비식별 성능 통계 | 정책별 | 재식별 불가 요건 충족 여부 확인 |
| 결제·세금 증빙 | 법령·계약 기준 | 법적 보존의무에 따라 별도 처리 |

제안 기간은 제품 정책 확정 전의 **초기 설계값**이며 최종 개인정보 처리방침이 아니다.

---

# 8. 백엔드 API 계약 (REST v1)

## 8.1 공통 규약

- Base URL: `/api/v1` (공개 BFF가 내부 API와 연결).
- Content-Type: `application/json; charset=utf-8`.
- 인증: Secure, HttpOnly, SameSite=Lax 또는 Strict 세션 쿠키. CSRF 및 origin 검사.
- 로컬 러너: 사용자 세션 쿠키를 사용하지 않음. 별도 device auth + nonce/signature.
- Create/execute/approve/cancel 요청은 `Idempotency-Key` 또는 리소스 버전(ETag/If-Match) 사용.
- 모든 목록: `limit <= 100`, opaque `cursor`, `hasMore`.
- 요청·응답은 공유 Zod 스키마로 검증하고 OpenAPI를 자동 생성한다.
- 에러는 키, 메시지, 재시도 여부, trace ID를 포함하고 비밀을 노출하지 않는다.

### 공통 에러 예시

```json
{
  "error": {
    "code": "RUNNER_OFFLINE",
    "message": "연결된 로컬 실행기가 오프라인입니다.",
    "retryable": true,
    "traceId": "trc_example",
    "details": { "recommendedAction": "start_local_runner" }
  }
}
```

### 주요 상태 코드

- `200` 조회/갱신 성공, `201` 생성 성공, `202` 비동기 처리 접수, `204` 삭제/취소 성공.
- `400` 포맷 오류, `401` 미로그인, `403` 권한/정책 거절, `404` 없는 리소스 또는 다른 워크스페이스.
- `409` 상태 충돌/멱등성 키 payload 불일치, `410` 만료된 코드, `422` 명세 검증 실패, `429` 한도 초과.
- `503` 제공사/러너/백엔드 일시 이용 불가.

## 8.2 인증 및 워크스페이스

| Method | Path | 목적 | 권한 |
|---|---|---|---|
| GET | `/me` | 현재 사용자 프로필 | 로그인 |
| GET | `/workspaces` | 접근 가능한 워크스페이스 | 로그인 |
| POST | `/workspaces` | 워크스페이스 생성 | 로그인 |
| GET | `/workspaces/:workspaceId` | 상세 | viewer+ |
| PATCH | `/workspaces/:workspaceId` | 설정 변경 | admin+ |
| GET | `/workspaces/:workspaceId/members` | 멤버 목록 | admin+ |
| POST | `/workspaces/:workspaceId/invitations` | 초대 | admin+ |
| DELETE | `/workspaces/:workspaceId/members/:memberId` | 접근 제거 | admin+, owner 보호 |

## 8.3 프로젝트

| Method | Path | 목적 |
|---|---|---|
| GET | `/workspaces/:w/projects` | 목록 |
| POST | `/workspaces/:w/projects` | 생성 |
| GET | `/workspaces/:w/projects/:p` | 상세 |
| PATCH | `/workspaces/:w/projects/:p` | 이름·설정 변경 |
| DELETE | `/workspaces/:w/projects/:p` | soft delete/연결 해제 |
| GET | `/workspaces/:w/projects/:p/preflight` | 실행 준비도 검사 |

### `POST /workspaces/:w/projects` 예시

```json
{
  "name": "Disclosure Insights",
  "description": "금융 공시를 근거 중심으로 요약하는 웹 앱",
  "source": {
    "type": "github",
    "githubInstallationId": "1234567",
    "repositoryFullName": "example-org/disclosure-insights",
    "branch": "main"
  },
  "defaultRuntime": "cloud",
  "defaultProvider": "auto",
  "executionPolicy": {
    "allowNetwork": false,
    "allowGitPush": false,
    "allowDeployment": false,
    "requireApprovalForDestructiveActions": true
  }
}
```

### 응답 예시

```json
{
  "id": "018f0000-0000-7000-8000-000000000001",
  "workspaceId": "018f0000-0000-7000-8000-000000000002",
  "name": "Disclosure Insights",
  "sourceType": "github",
  "defaultRuntime": "cloud",
  "createdAt": "2026-11-04T00:00:00Z"
}
```

## 8.4 모델 연결

| Method | Path | 목적 |
|---|---|---|
| GET | `/workspaces/:w/connections` | 상태/방식 목록(비밀 제외) |
| POST | `/workspaces/:w/connections/api-key` | BYOK 등록 |
| POST | `/workspaces/:w/connections/:c/health-check` | 최소 범위 연결 테스트 |
| DELETE | `/workspaces/:w/connections/:c` | 철회/비밀 파기 |
| GET | `/workspaces/:w/providers/capabilities` | 현재 허용된 모델 기능 |
| GET | `/workspaces/:w/providers/legal-gates` | 연결 가용 상태 |

**BYOK 등록 보안 계약:** Request에는 API 키가 포함될 수 있으나 reverse proxy/access log/APM/body capture에서 필드 전체를 삭제하고, TLS 검증 후 직접 Vault에 암호화 저장한다. API 키 조회 엔드포인트는 구현하지 않는다. 키 변경은 재등록.

## 8.5 Runner 페어링/등록

| Method | Path | 목적 |
|---|---|---|
| POST | `/workspaces/:w/runner-pairings` | 1회 코드 발급 |
| POST | `/runner/pairings/redeem` | 러너 키/코드로 교환 |
| GET | `/workspaces/:w/runners` | 등록 장치 |
| POST | `/workspaces/:w/runners/:id/rotate` | 디바이스 키 회전 시작 |
| DELETE | `/workspaces/:w/runners/:id` | 연결 폐기 |
| POST | `/workspaces/:w/runners/:id/workspaces` | 경로 허용은 로컬 동의 추가 필요 |
| GET | `/runner/session` | 연결 인증(디바이스 서명 필요) |

### 페어링 코드 발급

```json
{
  "pairingId": "uuid",
  "pairingCode": "ABCD-EFGH-JKLM",
  "expiresAt": "2026-11-04T00:10:00Z",
  "instructions": "로컬 ASO Runner에서 aso-runner pair 명령으로 입력하세요."
}
```

- 실제 코드는 충분한 무작위성(예: 96bit 이상), 서버 해시 저장, TTL 10분, 1회 사용, IP/계정/디바이스 rate-limit.
- 페어링 응답에 영구 액세스 토큰을 평문으로 반복 반환하지 않는다.
- 디바이스 서명키는 러너 OS keychain/제한된 로컬 저장소에 보관한다.

## 8.6 실행(Run) 엔드포인트

| Method | Path | 목적 |
|---|---|---|
| GET | `/workspaces/:w/projects/:p/runs` | 실행 히스토리 |
| POST | `/workspaces/:w/projects/:p/runs` | 새 실행 생성 |
| GET | `/workspaces/:w/runs/:runId` | 최신 상태/요약 |
| GET | `/workspaces/:w/runs/:runId/requirements` | 구조화 요구사항 |
| PATCH | `/workspaces/:w/runs/:runId/requirements` | 계획 전 요구 수정 |
| GET | `/workspaces/:w/runs/:runId/plan` | 현재 계획 |
| POST | `/workspaces/:w/runs/:runId/plan/approve` | 계획 승인 |
| POST | `/workspaces/:w/runs/:runId/pause` | 일시정지(지원 경계) |
| POST | `/workspaces/:w/runs/:runId/resume` | 재개 |
| POST | `/workspaces/:w/runs/:runId/cancel` | 취소 요청 |
| GET | `/workspaces/:w/runs/:runId/tasks` | DAG 노드 |
| GET | `/workspaces/:w/runs/:runId/events` | SSE 스트림 |
| GET | `/workspaces/:w/runs/:runId/artifacts` | 산출물 목록 |
| GET | `/workspaces/:w/runs/:runId/usage` | 사용량 집계 |

### 실행 생성 요청

```json
{
  "request": "기존 프로젝트에 공시 검색과 요약 페이지를 추가해줘",
  "runtime": "local",
  "executionMode": "auto",
  "providerPreference": "auto",
  "budget": {
    "maxWallTimeSeconds": 1800,
    "maxEstimatedCostUsd": 5,
    "maxParallelTasks": 2,
    "hardStopOnBudget": true
  },
  "options": {
    "requirePlanApproval": true,
    "allowExternalSkills": false,
    "createPullRequest": false
  }
}
```

### 실행 생성 응답

```json
{
  "runId": "uuid",
  "status": "queued",
  "links": {
    "self": "/api/v1/workspaces/w/runs/uuid",
    "events": "/api/v1/workspaces/w/runs/uuid/events"
  }
}
```

## 8.7 승인 및 아티팩트

| Method | Path | 목적 |
|---|---|---|
| GET | `/workspaces/:w/runs/:r/approvals` | 보류 승인 목록 |
| POST | `/workspaces/:w/approvals/:a/decide` | 허용/거부 |
| GET | `/workspaces/:w/artifacts/:a` | 메타데이터 |
| POST | `/workspaces/:w/artifacts/:a/download-url` | 단기 서명 다운로드 URL |
| POST | `/workspaces/:w/runs/:r/github/pr` | PR 생성(승인된 경우) |

### 승인 요청 객체

```json
{
  "approvalId": "uuid",
  "runId": "uuid",
  "taskId": "uuid",
  "action": "shell.execute",
  "purpose": "의존성 설치 후 테스트 실행",
  "commandPreview": "pnpm install --frozen-lockfile",
  "commandDigest": "sha256:...",
  "affectedPaths": ["project-root/**"],
  "networkAccess": true,
  "expiresAt": "2026-11-04T01:00:00Z",
  "riskLevel": "medium"
}
```

**승인 결정의 동시성:** 이미 만료/결정된 승인에 대한 2회 결정은 `409`; 서로 다른 명령 digest에 대한 승인 재사용 금지. 결정은 `approval_id + version` CAS 업데이트.

## 8.8 Skills/Usage/Billing/Benchmark

| Method | Path | 목적 |
|---|---|---|
| GET | `/workspaces/:w/skills` | 스킬 목록/설치 상태 |
| POST | `/workspaces/:w/skills/:s/enable` | 권한 및 공급망 검사 후 활성화 |
| POST | `/workspaces/:w/skills/:s/disable` | 비활성화 |
| GET | `/workspaces/:w/usage?from=&to=` | 사용량 요약 |
| GET | `/workspaces/:w/benchmarks` | 평가 실행 결과 |
| POST | `/workspaces/:w/benchmarks/runs` | 지정된 fixture 실험 생성(관리자) |
| GET | `/workspaces/:w/billing` | 요금제·한도 |
| POST | `/workspaces/:w/billing/checkout` | 과금 활성화 뒤만 |
| POST | `/integrations/psp/webhook` | 결제사 서명 검증 후 처리 |

**초기 버전에서 미구현 API는 404 또는 명확한 `FEATURE_NOT_ENABLED` 반환. 성공처럼 보이는 빈 데이터나 가짜 사용량을 반환하지 않는다.**

---

# 9. 이벤트와 실시간 통신 계약

## 9.1 표준 이벤트 스키마

```ts
type RunEvent = {
  id: string;               // persisted event ID
  runId: string;
  sequence: number;         // per-run strictly increasing
  timestamp: string;        // ISO 8601 UTC
  type:
    | 'run.created' | 'run.refining' | 'run.plan_ready'
    | 'run.awaiting_plan_approval' | 'run.started'
    | 'task.ready' | 'task.started' | 'task.progress'
    | 'task.approval_requested' | 'task.approved' | 'task.denied'
    | 'task.completed' | 'task.failed' | 'task.retry_scheduled'
    | 'run.verifying' | 'run.completed' | 'run.partial'
    | 'run.failed' | 'run.cancelled' | 'run.paused'
    | 'runner.connected' | 'runner.disconnected'
    | 'usage.reported' | 'artifact.created';
  actor: { type: 'user' | 'system' | 'worker' | 'runner'; id?: string };
  payload: Record<string, unknown>; // type별 추가 Zod schema
};
```

`task.progress` 이벤트는 델타를 무제한 저장하지 않는다. 텍스트 스트림은 제한된 샘플링 또는 별도 object storage에 암호화 저장한 뒤 메타데이터 이벤트만 남긴다.

## 9.2 SSE

- Endpoint: `GET /api/v1/workspaces/:w/runs/:r/events`.
- 헤더: `Accept: text/event-stream`.
- 응답: `id: <sequence>`, `event: <type>`, `data: <JSON>`.
- 브라우저는 reconnect 때 `Last-Event-ID`를 보내고 서버는 누락된 이벤트부터 replay한다.
- 서버는 워크스페이스 접근권한을 인증·검사한 뒤 SSE stream을 연다.
- heartbeat 이벤트는 상태 데이터가 아니며 주기적으로 전송.
- UI의 상태는 이벤트를 캐시해 보여주되 불일치 시 REST snapshot이 우선.
- 이벤트 replay 한도 초과 시 전체 snapshot 재요청 유도.

## 9.3 로컬 러너 WebSocket 프로토콜

러너는 **서버로 outbound** `wss://.../runner/connect` 연결을 생성한다. 서버가 사용자 PC에 임의로 inbound 접속하지 않는다.

```json
{
  "protocolVersion": "1.0",
  "messageId": "uuid",
  "deviceId": "uuid",
  "timestamp": "2026-11-04T00:00:00Z",
  "nonce": "random",
  "type": "job.offer",
  "payload": {
    "jobId": "uuid",
    "runId": "uuid",
    "projectId": "uuid",
    "taskKey": "implement-api",
    "expiresAt": "2026-11-04T00:01:00Z",
    "contractDigest": "sha256:..."
  },
  "signature": "base64-ed25519-signature"
}
```

### 필수 메시지 타입

`runner.hello`, `runner.challenge`, `runner.auth`, `runner.heartbeat`, `runner.health`, `job.offer`, `job.accept`, `job.reject`, `job.start`, `job.progress`, `job.result`, `job.cancel`, `approval.request`, `approval.decision`, `runner.error`.

### 전달 신뢰성

- `messageId` 중복 도착 시 idempotent하게 처리.
- `job.offer`는 서버의 **대상 device_id, workspace_id, 실행 계약 digest, TTL, 권한 버전**에 묶여 있다.
- 러너는 서명·nonce·TTL·workspace permission·local allowlist를 검증하고 수락한다.
- heartbeat 상실 시 서버는 작업을 `unknown`으로 두고 재연결·실행 상태를 대조한다. 곧바로 다른 러너에서 동일 작업 재실행하지 않는다.
- 러너 측 `job.result`는 최종 상태·검증 증거를 포함; 서버는 다시 정책 및 결과 스키마 검증.
- WS는 transport일 뿐, 명령 권한은 서버 권한검사 + 러너 로컬 정책이 **둘 다 통과**해야 한다.

## 9.4 Outbox 패턴

1. DB 트랜잭션에서 `run.status` 변경 + `run_events` insert + `outbox` insert.
2. Outbox relay가 Redis/BullMQ에 job을 발행.
3. 성공 후 outbox row를 delivered로 변경.
4. 소비자는 `job_id`와 `task_id`에 대해 중복 처리 방지.
5. Worker 재시작 시 미처리 outbox를 복구한다.

`DB commit`만 성공한 상태에서 Redis publish에 실패해도 작업이 영구 유실되지 않아야 한다.


---

# 10. Local Runner: 설치, 페어링, 작업 실행, 안전

## 10.1 러너의 최소 공개 CLI

```bash
aso-runner --version
aso-runner doctor                 # 설치된 CLI/런타임/권한 확인, 비밀 값 출력 금지
aso-runner pair                   # 웹에서 받은 1회 코드를 직접 입력
aso-runner workspace add          # 사용자가 허용할 로컬 프로젝트 경로를 선택
aso-runner workspace list
aso-runner workspace revoke
aso-runner start                  # outbound WS 연결 및 작업 수신
aso-runner status
aso-runner stop
aso-runner unpair                 # 로컬 디바이스 키/서버 등록 무효화
```

위 명령은 **ASO에서 새로 구현할 명령**이고, 이미 존재하는 공개 패키지의 명령이 아니다.

## 10.2 설치와 최초 등록

1. 사용자 OS 확인(Windows/macOS/Linux) 및 런타임/배포 방식 선택.
2. `npm`/`pnpm` 실행기 또는 서명된 단일 실행 바이너리로 배포; MVP는 Node 런너로 시작.
3. 시작 시 Ed25519 기기 키쌍 생성. private key는 OS keychain 사용을 우선하고 실패 시 파일 permission 제한.
4. `pair` 호출에서 1회 코드를 입력. 코드와 공개키를 TLS로 전송; 서버는 만료/중복/시도횟수 검사.
5. 서버가 등록한 `device_id`를 반환. 러너는 challenge/response로 기기 소유를 증명한다.
6. 사용자가 직접 허용한 프로젝트 경로와 권한을 로컬 config에 기록.
7. `doctor`가 공식 CLI 설치/버전 및 이용가능 경로 확인. API 키·로컬 인증 토큰은 덤프하지 않는다.
8. 초기 로그인/인증은 각 제공사의 공식 CLI 또는 API 경로를 사용.

## 10.3 로컬 폴더 권한 계약

```ts
type LocalWorkspaceGrant = {
  projectId: string;
  canonicalPath: string;     // only stored on local runner; never required server side
  pathFingerprint: string;   // hash of canonical path + local salt
  allowedActions: Array<'read' | 'write' | 'test' | 'git_branch' | 'git_push'>;
  allowedExecutables: string[];  // names + resolved binary paths
  networkPolicy: 'deny' | 'approved_hosts' | 'allow';
  protectedGlobs: string[];  // e.g. .env*, **/secrets/**, ~/.ssh/**
  createdAt: string;
  revokedAt?: string;
};
```

- `path.resolve`와 realpath로 상위 경로·symlink 탈출을 차단한다.
- 상대 경로 `../../`, symlink, hardlink, 마운트 포인트, UNC path 등 플랫폼별 edge-case 검사.
- 임의 home directory 전체 허용을 기본값으로 제시하지 않는다.
- 로컬 git 변경사항이 존재하면 기본적으로 원본 작업 트리를 보존: branch/worktree를 만들거나 사용자 승인.
- `git reset --hard`, `clean -fdx`, `rm`, 외부 업로드, 배포 등은 별도 권한 게이트.
- AI 작업 시작 전 `git status --porcelain`, branch, clean/dirty 여부를 기록.

## 10.4 실행 요청 검증 체인

```text
[서버] 인증된 사용자 → workspace RBAC → 실행 정책 → job contract 생성
   ↓ signed job
[러너] 장치 키/서명 검증 → TTL/nonce 검증 → grant path 확인
   ↓
[러너] 액션 타입/프로세스 allowlist 확인 → 환경변수/비밀 필터
   ↓
[러너] 위험 명령은 별도 승인 → 격리 작업경로 설정
   ↓
[러너] 프로세스 실행 → timeouts/output 제한 → 종료 상태 수집
   ↓
[서버] 결과/아티팩트 무결성 검증 → 테스트 evidence 저장
```

## 10.5 프로세스 실행 정책

- `spawn`/`execFile`처럼 명령과 인수를 분리하는 API 사용. 임의 문자열을 shell에 그대로 전달하는 `exec(...)`는 기본 금지.
- `cwd`는 허용된 workspace/worktree 내부. 프로세스 UID는 최소 권한.
- `env`는 명시한 키만 전달; 부모 프로세스 전체 환경을 무조건 상속하지 않는다.
- stdout/stderr 바이트·행·전송률 제한, 자동 비밀 마스킹, 취소 시 프로세스 그룹 종료.
- CPU/memory/time/pid 제한(로컬은 OS별 지원 수준에 맞게), Cloud는 강제 제한.
- 자식 프로세스가 `git`, package manager, shell, network를 재실행할 수 있는 사실을 고려: 인수 allowlist만으로 완전한 샌드박스가 되지 않으므로 위험 작업은 더 강한 OS 격리를 사용.
- 허용 도메인 네트워크 제어는 DNS rebinding, IP 직접 접속, 사설망 SSRF 등을 고려해 프록시·네트워크 정책에서 검사.
- 설치 스크립트(`npm install`의 lifecycle script 등)도 코드 실행으로 취급한다.

## 10.6 Runner 상태 머신

`unpaired → paired_offline → connecting → online → busy → online → disconnected/revoked`.

- 버전 불일치: `upgrade_required`로 읽기만 가능. 하위 프로토콜 변환이 구현된 경우에만 호환.
- `runner offline` 상태에서 웹 작업을 local로 요청하면 `queued_waiting_for_runner`, TTL 경과 시 `expired`.
- 작업 도중 네트워크 단절 시 현지에서 실행된 프로세스/상태를 유지할지 안전하게 정해야 함. MVP는 **작업을 새로 시작하지 않고 정지/상태확인** 기본.
- 재연결 시 `lastAckedEvent`, `runningTaskIds`, `resultDigest`를 보고 서버와 reconcile.

## 10.7 Runner 자체 업데이트

- 자기 업데이트는 별도 승인, 서명 검증, rollback 절차를 갖는다.
- 제3자 저장소에서 다운로드한 바이너리·스킬을 임의 실행하지 않는다.
- 배포 아티팩트 서명, checksum, SBOM, release provenance를 제공.
- UI에서 실행기 버전과 최신 버전 안내.

# 11. Cloud Sandbox와 GitHub 연동

## 11.1 Cloud 실행 기본 원칙

- 초기에는 `ENABLE_CLOUD_SANDBOX=false`. M2에서 독립 보안 검증 통과 후 활성화.
- 사용자별/작업별 ephemeral 컨테이너. 가능하면 각 작업에 서로 다른 Linux 사용자와 네트워크 경계.
- 런타임 이미지는 최소 이미지, 비루트, read-only root filesystem, no privileged mode, seccomp/AppArmor, cap drop, pid/resource limit.
- 사용자 스킬/코드는 신뢰하지 않는 입력. sandbox image에 API 키를 굽지 않는다.
- 네트워크는 기본 outbound deny, 승인된 도메인만 연결. 내부 metadata/IP/private network 차단.
- 실행 완료 후 컨테이너/임시 스토리지 제거, 비밀 env와 프로세스 종료 여부 검사.
- 데이터 유출 위험이 높은 민감한 저장소는 로컬 실행만 허용하거나 조직 승인 필요.

## 11.2 Cloud 실행 단계

1. GitHub installation token을 최소 TTL로 발급.
2. 지정한 브랜치를 격리된 sandbox에 clone 또는 shallow fetch.
3. 초기 commit SHA 고정. branch protection과 사용자 권한 검사.
4. 작업용 브랜치 `aso/<run-id>/<task-id>` 생성.
5. base image + package cache는 비밀 없는 경우에만 재사용.
6. 요청에 필요한 파일만 추출·색인, 모델에 전달하는 내용 최소화.
7. provider API 또는 허용된 공식 실행 경로로 작업 수행.
8. 테스트/빌드/보안 스캔.
9. 브랜치 결과 병합/검증 후 사용자가 요청한 경우에만 PR 생성.
10. 종료 후 지연된 이벤트 reconcile, 아티팩트 저장·컨테이너 삭제.

## 11.3 GitHub App 권한 설계

- 설치 시 저장소 선택 옵션 사용. 모든 저장소 접근 기본값 금지.
- 초기 권한: Repository metadata read, Contents read; PR 생성 기능 활성화 시 Contents write 및 Pull Requests write를 별도 요청.
- Webhook 이벤트: `installation`, `installation_repositories`, 필요하면 `pull_request`, `push`.
- 서명 검증 필수: GitHub webhook secret 기반 HMAC을 raw payload에 대해 검증.
- GitHub App private key는 Vault 보관. installation access token은 단기 발급·메모리 전용.
- GitHub 연결 해제/저장소 철회 시 새 작업을 중단하고 기존 작업의 토큰 권한을 폐기.
- 배포형 사용자에게 GitHub OAuth 개인 액세스 토큰 전체 복사를 요구하지 않는다.

## 11.4 파일 병렬 처리 및 Git 전략

| 상황 | 실행 전략 |
|---|---|
| 서로 다른 파일/폴더, 인터페이스 확정 | 별도 git worktree로 병렬 |
| 동일 파일 수정 필요 | 순차 실행 또는 ownership 분리 |
| 공유 스키마/타입 생성 | 공통 계약 task를 선행 |
| 패키지 lockfile 수정 | 전용 작업만 소유, 나머지 병합 후 재생성 |
| DB migration | 충돌 순서와 적용 시점 고정 |
| 테스트와 구현 | 테스트 계획은 병렬, 최종 테스트는 구현 후 |

`task.fileScope`는 힌트에 불과하며 실제 diff를 검사해야 한다. 선언하지 않은 파일이 변경되면 통합 전에 경고/재검토.

## 11.5 PR 생성 정책

- PR 제목과 본문에 `ASO Run ID`, 요구사항 요약, 검증 결과, 남은 위험, 사용된 스킬/모델을 기록.
- secret/credential/사용자 파일을 diff에 포함하지 않는지 검사.
- CI 필수 통과가 없는 PR은 `draft` 또는 명확한 검증 실패 표시.
- Protected branch direct push 기본 금지.
- `merge`는 별도 사용자 권한과 승인 없이는 실행하지 않는다.

# 12. AI 제공사 어댑터 상세 설계

## 12.1 통합 인터페이스

```ts
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'mock';
export type ProviderRuntime = 'api' | 'local-native' | 'partner-oauth';

export type AgentTaskRequest = {
  runId: string;
  taskId: string;
  workspaceId: string;
  goal: string;
  acceptanceCriteria: string[];
  repoContext: { commitSha: string; allowedPaths: string[]; snippets: string[] };
  skills: Array<{ name: string; digest: string; promptFragment?: string }>;
  outputContract: string;
  limits: { maxTurns: number; maxWallMs: number; maxOutputTokens?: number };
  permissionPolicy: { network: boolean; shell: boolean; write: boolean };
};

export type AgentTaskResult = {
  taskId: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  summary: string;
  changedFiles: string[];
  artifacts: string[];
  tests: Array<{ command: string; exitCode: number; passed: boolean }>;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cacheWriteTokens?: number;
    providerReportedCostUsd?: number;
    source: string;
  };
  warnings: string[];
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly runtime: ProviderRuntime;
  checkConnection(): Promise<{ ready: boolean; reason?: string }>;
  listCapabilities(): Promise<string[]>;
  execute(task: AgentTaskRequest, signal: AbortSignal): Promise<AgentTaskResult>;
  // 구현별 normalize events, usage; provider-specific auth remains isolated.
}
```

- 상위 Orchestrator가 SDK 객체/비밀을 직접 알지 못하게 한다.
- 어댑터는 capability matrix에서 `supports_tools`, `supports_json`, `supports_session_resume`, `supports_native_cli`, `can_measure_usage` 등을 선언.
- 중단·타임아웃 시 `AbortSignal`을 실제 provider/child process에 전파.
- 실패 유형(`auth`, `rate_limit`, `billing`, `timeout`, `policy`, `validation`, `provider_error`)을 표준화.
- 모델 교체는 비용/리스크/사용자 선호를 검증하고 별도 승인 정책을 적용.

## 12.2 OpenAI/Codex — 단계별 구현

### A. 기본 API 모드

- 사용자 OpenAI API 키로 공식 SDK/Responses API 또는 공식 Codex SDK의 허용된 API 경로 사용.
- ASO는 API key를 본문/로그에 노출하지 않는다.
- tool execution과 사용자 권한 관리는 ASO의 sandbox/runner 정책에 통합.
- 출력 JSON과 토큰 사용량이 제공되면 정규화; 빠진 값은 `unavailable`.

### B. 로컬 Codex 모드

- Local Runner가 사용자 PC의 공식 `codex` 설치 여부와 버전을 검사.
- 사용자 자신의 CLI에서 공식 로그인. ASO는 세션 토큰을 추출하지 않는다.
- 가벼운 작업에는 `codex exec`를 고려하고, 지속적 UI/승인/이벤트가 필요하면 공식 Codex SDK 또는 app-server 프로토콜을 검토.
- 구체적인 CLI 플래그 및 프로토콜 버전은 설치 시 공식 문서에서 확인하고 smoke test로 고정.
- `codex` 프로세스의 실행 범위·파일 권한은 Local Runner 정책을 넘을 수 없다.
- 외부 SaaS가 구독 사용량을 직접 위임받아 처리하는 것과 사용자 로컬에서 공식 CLI를 실행하는 것은 법적·기술적으로 별도 경로다.

### C. Sign in with ChatGPT (파트너 승인 기능)

- 정식 파트너 등록과 승인된 OAuth client가 존재할 때만 feature flag 활성화.
- Authorization Code + PKCE, `state`, OIDC `nonce`, `iss`, `aud`, `exp`, `sub` 검증.
- '사용자 신원 로그인'과 'ChatGPT 구독 사용량 위임'은 동의·scope가 다르다.
- 구독 사용량 scope가 없으면 inference 미허용. BYOK 대안을 표시.
- 만료/철회/refresh/재동의는 제공사 공식 flow만 사용.
- 전용 인증 경계와 작업 권한 검사 후에만 API에 access token 전달.
- 지원 모델·요청 형식·요금·사용 한도는 제공사 승인 범위에 한정.
- 이 기능은 MVP 출시에 포함하지 않는다.

**참고:** https://developers.openai.com/siwc/website 및 https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

## 12.3 Anthropic/Claude Code

### A. 기본 API 모드

- 고객 소유 Anthropic API 키 또는 허용된 클라우드 제공사 자격증명 사용.
- 공식 Anthropic SDK/Agent SDK로 API를 호출한다.
- Claude Code를 제품 안에서 실행하는 경우 상업 약관, 무수정 binary, 인증 선택권 및 사용자 직접 청구 조건을 점검한다.
- API 키를 제공사 이름의 '구독 연결'이라고 표시하지 않는다.

### B. 로컬 네이티브 모드

- 문서의 `LOCAL_NATIVE_CLI` 구현 자체와, 이를 상용 제3자 제품에 노출할 권한 검토를 분리한다.
- 계약·사용 정책 검토가 완료되기 전에는 UI feature flag OFF.
- 사용자 자체 CLI 로그인은 공식 Claude Code에서만 진행. 토큰 추출·자동 전달 금지.
- 프로그램적으로 기능을 제어할 때는 공식 Agent SDK + 사용자 API 키 경로가 우선.
- 사용자 CLI를 단순히 wrapper로 감싸는 작업도 약관·목적에 따라 검토 대상이 될 수 있다.

### C. 절대 금지 구현

- ASO 사이트 안에서 `Sign in with Claude.ai`를 사칭하여 로그인 수행.
- 로컬 `~/.claude` 인증 cache 등에서 OAuth 토큰을 가져오는 코드.
- 사용자 Pro/Max 인증을 클라우드 inference proxy로 바꿔 타 사용자 요청 처리.

**참고:** https://code.claude.com/docs/en/legal-and-compliance

## 12.4 Google/Gemini

### A. 기본 API 모드

- Google AI Studio 또는 Vertex AI의 공식 API 키/승인된 인증 경로 사용.
- Model capability/가격/제한은 해당 API와 프로젝트 설정에서 조회·검증.
- 개인정보·데이터 처리 조건은 인증 방식 및 계약에 따라 별도 표시.

### B. 로컬 CLI 모드의 경계

- Gemini CLI 공식 headless mode는 구조화 출력(`--output-format json` 또는 `stream-json`)을 지원한다.
- 하지만 Google은 제3자 도구가 Gemini CLI의 OAuth 인증을 수확하거나 피기백하여 백엔드 서비스에 접근하는 행위를 금지한다고 명시한다.
- 따라서 상용 ASO가 사용자의 CLI OAuth를 활용해 대신 inference하는 기능은 기본적으로 **비활성화**한다.
- 추후 해당 서비스 형태가 Google의 공식 문서/서면 승인에 부합하는지 확인될 때만 경계와 정책을 다시 설계한다.
- 기본 상용 경로는 직접 API 키(또는 Vertex AI 프로젝트 인증)다.

**참고:** https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md 및 https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md

## 12.5 Provider 선택 알고리즘

```ts
function selectProvider(
  candidates: Array<{
    id: ProviderId;
    connected: boolean;
    policyAllowed: boolean;
    taskCapabilityMatch: number;
    predictedLatencyMs: number;
    predictedCostUsd?: number;
    reliabilityScore: number;
  }>,
  budget: { maxEstimatedCostUsd?: number },
) {
  const eligible = candidates.filter(c =>
    c.connected && c.policyAllowed && c.taskCapabilityMatch >= 0.8 &&
    (budget.maxEstimatedCostUsd === undefined ||
      (c.predictedCostUsd !== undefined && c.predictedCostUsd <= budget.maxEstimatedCostUsd))
  );
  if (!eligible.length) throw new Error('NO_COMPLIANT_PROVIDER');
  return eligible.sort((a, b) =>
    (b.taskCapabilityMatch * 0.5 + b.reliabilityScore * 0.3 - b.predictedLatencyMs / 1e6) -
    (a.taskCapabilityMatch * 0.5 + a.reliabilityScore * 0.3 - a.predictedLatencyMs / 1e6)
  )[0];
}
```

예시는 구조 설명용 휴리스틱이며 `0.8`, `0.5`, `0.3`은 **실측으로 튜닝해야 할 가정치**다. `predictedCostUsd`가 없는 provider는 하드 비용 상한을 충족한다고 주장할 수 없으므로 예시에서는 제외했다.

## 12.6 Failover 금지/허용 조건

- 자격증명 만료 → 무단 다른 사용자 키로 대체 불가.
- 비용을 발생시키는 fallback → 사용자가 허용한 과금 경로로만.
- 개인정보·프로젝트 코드의 다른 제공사 전송 → 정책·사용자 사전 동의 필요.
- 위험성이 높은 코드 작업은 다른 모델이 중간 결과를 검증하는 옵션을 사용할 수 있으나 병렬 무조건 호출 금지.
- 컨텍스트 유출을 막기 위해 모델별 전달 파일 범위를 별도로 구성.

# 13. ASO Skill Orchestrator 엔진

## 13.1 핵심 파이프라인

```mermaid
flowchart TD
  U[Raw Request] --> I[Intent Refiner]
  I --> M{FAST / STANDARD / DEEP}
  M --> P[Plan + Acceptance Criteria]
  P --> R[Local Skill Registry]
  R --> D{Capability Gap?}
  D -- Yes --> F[find-skills Candidate Search]
  D -- No --> X[Skill Selection]
  F --> X
  X --> C[Conflict & Policy Filter]
  C --> G[DAG Generator]
  G --> S[Scheduler + Provider Router]
  S --> T[Test / Verification]
  T --> Q[Result / Evidence]
  Q --> L[Metrics + Combination Feedback]
```

## 13.2 재사용할 기존 엔진 구성요소

| 기존 스킬/기술 | ASO Web 내 담당 | 실행 기준 | 피할 중복 |
|---|---|---|---|
| `find-skills` | 부족한 능력 탐색 | 등록 스킬로 해결 못 할 때만 | 매번 웹 검색 금지 |
| `superpowers` | planning/implementation/test workflow | STANDARD/DEEP에서 관련 부분만 | ECC planner 중복 금지 |
| `andrej-karpathy-skills` | 정확한 목표·간결한 구현 원칙 | 짧은 규칙으로 공통 적용 | 원본 전체 반복 로딩 금지 |
| `matt-pocock-skills` | 요구사항 검토 및 빈틈 식별 | 높은 모호성/치명적 가정 | 모든 요청에 질문 강제 금지 |
| `Graphify` | 복잡한 repo 구조 파악 | 코드베이스 규모와 변경 범위가 클 때 | 작은 수정에서 전체 그래프 생략 |
| `claude-mem` | 관련 기록 검색 | 명시적 관련 맥락 필요 시 | ECC 메모리와 중복 금지 |
| `Ponytail` | 과잉 구현·불필요 추상화 제거 | 계획 및 리뷰 | 필수 기능 삭제 금지 |
| `Prompt caching` | 정적 지침/반복 prefix 재사용 | 공식 API 지원 시 | 캐시 히트를 가정하지 않음 |
| `ECC` | 언어·테스트·보안 전문 스킬 | 전문 능력 요구 시 | ECC 자체 orchestration/hook 기본 제외 |

**소유권/라이선스:** 각 외부 스킬의 실제 저장소와 버전은 사용자가 직접 제공하거나 공식/신뢰 가능한 출처에서 확인해 `skills.lock.json`에 고정한다. 작성자 이름을 포함한 비공식 스킬을 원저작자의 공식 제품으로 표현하지 않는다.

## 13.3 Intent Refiner 출력 스키마

```ts
interface RefinedRequest {
  original: string;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  constraints: Array<{ key: string; value: string; source: 'user'|'repo'|'inferred' }>;
  assumptions: Array<{ text: string; confidence: number; mustConfirm: boolean }>;
  acceptanceCriteria: Array<{
    id: string;
    statement: string;
    verification: 'unit_test'|'integration_test'|'e2e'|'static_check'|'human_review';
  }>;
  materialQuestions: string[];
  risk: 'low'|'medium'|'high';
  requestedArtifacts: string[];
}
```

### 고도화 정책

1. 사용자 원문, 현재 저장소 manifest, README, 주요 파일 및 이전 결정 중 **관련 있는 것만** 읽는다.
2. 목표·제약·완료 기준과 가정을 구분한다.
3. 기술 선택처럼 합리적으로 추론할 수 있는 것은 `assumptions`로 기록하고 진행한다.
4. 돈·데이터 삭제·공개 배포·권리 양도 등 중대한 선택은 질문한다.
5. 질문이 필요하더라도 가능한 독립 작업(구조 분석, 테스트 fixture)부터 진행할 수 있다.
6. 사용자의 명시 요구와 충돌하는 추정은 즉시 배제한다.

## 13.4 실행 모드 분류

| 모드 | 조건 예시 | 계획 | 실행 | 검증 |
|---|---|---|---|---|
| FAST | 1~2 파일/단순 버그/명확한 요구 | 짧은 내부 계획 | 단일 worker, 전문 스킬 0~1 | 관련 테스트 |
| STANDARD | 기능 추가/API 연동/여러 파일 | acceptance + DAG | 필요 시 최대 2 worker | 관련 범위+회귀 |
| DEEP | 시스템 설계/광범위 리팩터링/고위험 | 상세 계획 승인 | 조건부 병렬 3~4개 | 심층 통합/보안/리뷰 |

- 초기 값 `2`, `4`는 기본 동시성 **제안값**이며 사용자 환경/비용에 맞춰 변경.
- 위험도 `high`이면 작은 수정도 테스트/승인 수준을 높인다.
- 실행 모드 분류에는 별도의 유료 모델 호출 없이 휴리스틱으로 시작하고 불확실한 경우에만 경량 호출.

## 13.5 Skill Registry 형식

```json
{
  "name": "ecc/security-review",
  "source": "https://github.com/affaan-m/ECC",
  "sourceCommit": "PINNED_COMMIT_SHA_REQUIRED",
  "license": "VERIFY_AT_INSTALL",
  "sha256": "COMPUTE_AT_INSTALL",
  "capabilities": ["security.review", "code.audit"],
  "languages": ["typescript", "python"],
  "trigger": ["security_sensitive_changes"],
  "estimatedLoadTokens": null,
  "conflictsWith": ["parallel_global_planner"],
  "allowedStages": ["review", "verification"],
  "riskLevel": "unreviewed",
  "requiresHumanApproval": true,
  "enabled": false
}
```

`estimatedLoadTokens`는 실측치가 없는 한 `null`. 가짜 token count를 만들지 않는다.

## 13.6 Skill Routing 알고리즘

1. 작업의 capability 태그 추출 (`frontend.react`, `db.postgres`, `security.auth`, `test.e2e`).
2. local registry에서 capability + 언어 + 실행단계 필터.
3. 미보유 capability가 있고 검색 가치가 있을 때만 `find-skills` 실행(검색 호출 상한 1~2).
4. 스킬 선택 점수 계산: capability 적합도, 과거 검증 품질, 로딩 비용, 정책 리스크, 충돌.
5. Superpowers는 작업 방식, ECC는 전문기술. 같은 책임의 스킬 동시 활성화 금지.
6. 선택한 스킬만 load하고 digest를 기록. task 완료 시 worker 컨텍스트 종료.
7. 선택 이유·로딩량·결과를 사용량 원장과 연계.
8. 새 스킬 설치는 자동 수행하지 않고 승인·라이선스·정적 검사 후 가능.

### 라우팅 정책 YAML 예시

```yaml
orchestrator:
  single_authority: true
  default_mode: adaptive
skills:
  max_loaded_per_task:
    fast: 1
    standard: 3
    deep: 5
  allow_external_auto_install: false
  conflict_groups:
    process_planner: [superpowers-planner, ecc-planner]
    memory_writer: [claude-mem-writer, ecc-memory]
  mandatory_compact_principles:
    - clarify_material_ambiguity_only
    - prefer_minimal_safe_changes
    - test_before_claiming_completion
  ecc:
    specialist_only: true
    global_hooks_enabled: false
    separate_orchestrator_enabled: false
  memory:
    provider: claude-mem
    retrieve_only_when_relevant: true
```

## 13.7 스킬 조합 사례

| 요청 | 실행 모드 | 스킬 예시 | 병렬화 |
|---|---|---|---|
| 버튼 문구 수정 | FAST | Ponytail 압축 원칙 | 불필요 |
| API + 프론트 페이지 | STANDARD | Superpowers 해당 workflow + TypeScript specialist | 계약 정의 후 프론트/백엔드 병렬 |
| 인증/결제 기능 | DEEP | Superpowers + ECC security specialist + 테스트 | 설계 병렬, 위험 검증은 별도 |
| 대규모 리팩터링 | DEEP | Graphify + Superpowers + ECC language specialist | 파일 ownership 확정 후 |
| 과거 프로젝트 이어서 | STANDARD | claude-mem 필요한 과거 결정 검색 | 독립 구현에 한정 |
| 미보유 프레임워크 | STANDARD | find-skills 후보 검색, 승인 후 사용 | 선행 탐색 |

## 13.8 Memory·Graphify 사용 정책

- `claude-mem`: 기억을 항상 모든 태스크에 주입하지 않고 **관련 키워드/리포지토리/결정 시점**으로 검색. 사용자 요청에 따라 삭제/비활성화 가능해야 한다.
- `Graphify`: 저장소 크기·변경 범위가 threshold를 넘을 때 사용하고 그래프의 commit SHA가 현재 대상과 일치하는지 확인.
- 두 도구를 설치하지 않았더라도 grep/tree-sitter/일반 검색으로 안전한 기본 동작을 제공.
- 외부 메모리 플러그인이 중앙 SaaS로 파일 내용/사용자 프롬프트를 무단 업로드하지 않도록 데이터 경로 검토.

## 13.9 스킬 조합 학습

```ts
type CombinationOutcome = {
  taskSignature: string;     // e.g. hash(stack, capabilities, complexity)
  selectedSkills: string[];
  model: string;
  accepted: boolean;
  verifiedQualityScore?: number;
  wallMs: number;
  measuredCostUsd?: number;
  retryCount: number;
  evaluationVersion: string;
};
```

- 동일 조건에서 충분한 샘플이 모일 때만 조합 추천 가중치를 업데이트.
- 사용자 프로젝트 간 원문 코드·기밀을 학습 데이터로 병합하지 않는다.
- 성능이 나쁜 조합은 비활성화 또는 감점하고 회귀 테스트를 유지.
- 강화학습/RL이 아니어도 단순 규칙 + offline 분석으로 시작할 수 있다.

# 14. DAG·동시성·복구 가능한 실행 엔진

## 14.1 Task 표준 계약

```ts
interface DagTask {
  id: string;
  key: string;
  title: string;
  stage: 'research' | 'design' | 'build' | 'test' | 'review' | 'integration';
  dependencies: string[];
  allowedPaths: string[];
  exclusiveResources: string[]; // e.g. package-lock, schema, migration
  requiredCapabilities: string[];
  selectedProvider?: string;
  selectedSkills: string[];
  acceptanceCriteria: string[];
  timeoutMs: number;
  retryPolicy: { maxAttempts: number; backoffMs: number };
}
```

## 14.2 실행 상태 머신

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> refining
  refining --> planning
  planning --> awaiting_approval
  planning --> ready
  awaiting_approval --> ready: approve
  awaiting_approval --> cancelled: reject
  ready --> running
  running --> paused
  paused --> running
  running --> verifying
  verifying --> completed
  verifying --> partial
  verifying --> failed
  running --> failed
  running --> cancelled
  ready --> cancelled
  failed --> [*]
  completed --> [*]
  partial --> [*]
  cancelled --> [*]
```

각 상태 전이는 `allowedTransitions`를 중앙 정의하며, DB transaction 내 optimistic locking(버전) 또는 row lock으로 적용한다. UI가 상태를 직접 지정할 수 없고 이벤트만으로 상태를 위조하지 못한다.

## 14.3 Task 레벨 상태

`pending → ready → leased → running → verifying → succeeded`, 실패 경로는 `retry_wait`, `failed`, `cancelled`, `blocked`.

- `lease_expires_at`에는 worker heartbeat 기반의 만료 시간.
- 만료됐다고 무조건 재실행하지 않는다. 외부 side-effect가 있는 작업은 실행기 상태/중복 실행 결과부터 조회.
- `git push`, PR, 결제, 배포 등 side-effect 작업은 별도의 idempotency token 및 외부 자원 확인 필수.

## 14.4 DAG 유효성 검증

- 모든 dependency가 존재.
- 자기 자신에 대한 dependency 금지.
- DFS 또는 Kahn algorithm으로 cycle 감지.
- 서로 다른 파일 scope라도 동일 `exclusiveResource`가 있으면 동시 실행 금지.
- 프론트/백엔드 계약이 확정되지 않은 상태의 병렬 구현 금지.
- Task 수, depth, fan-out, 총 예상 비용 상한.
- `maxParallelTasks`는 workspace quota, runner capacity, provider rate limit의 **최솟값**.

## 14.5 Scheduler 의사코드

```ts
async function schedule(runId: string) {
  const run = await repository.lockRun(runId);
  if (!run || !['ready', 'running'].includes(run.status)) return;

  const tasks = await repository.getTasks(runId);
  validateDAG(tasks);

  const succeeded = new Set(tasks.filter(t => t.state === 'succeeded').map(t => t.key));
  const active = tasks.filter(t => ['leased','running','verifying'].includes(t.state));
  const capacity = Math.max(0, await computeMaxConcurrency(run) - active.length);

  const candidates = tasks.filter(t =>
    t.state === 'pending' &&
    t.dependencies.every(dep => succeeded.has(dep)) &&
    !conflictsWithActive(t, active) &&
    withinBudgetAndPolicy(run, t)
  ).slice(0, capacity);

  for (const task of candidates) {
    await repository.reserveLeaseAndWriteOutbox({ runId, taskId: task.id });
  }
}
```

실제 구현은 `lockRun`과 후속 모든 DB 작업의 트랜잭션 범위를 올바르게 묶어야 하며, `reserveLeaseAndWriteOutbox`는 원자적 CAS 상태 전이를 사용한다. 의사코드의 배열 순서 대신 우선순위(critical path, 비용, 위험)를 계산해 큐에 넣는다.

## 14.6 취소/중단/복구

- `cancel`은 요청 접수 후 `cancel_requested` 이벤트 발생 → 러너/샌드박스 작업 중지 → 상태 reconcile → `cancelled`.
- 즉시 kill이 위험한 DB migration 등은 safe checkpoint가 없으면 `cancelling` 상태로 표시.
- worker 강제 종료: lease가 끝나면 task와 local runner 실상태를 조사한 뒤 재시도 여부 결정.
- provider timeout: 외부 요청의 결과 확인이 가능하면 확인 후 재시도. 미확인 side effect는 중복 실행 금지.
- 부분 성공: 검증 가능한 산출물이 있지만 일부 acceptance가 실패하면 `partial`로 종료.
- 승인 만료: `blocked` 또는 `failed` 정책에 따라 종료; 무한 대기 금지.

## 14.7 합병 및 검증 게이트

1. task별 결과의 `changedFiles`·test evidence 검증.
2. 실제 git diff와 선언한 `fileScope` 비교.
3. 동시 작업 결과를 임시 통합 브랜치에 병합.
4. conflict 발생 시 파일별 owner와 변경 의도 비교 후 제한적 자동 재작업.
5. lockfile, DB migration, generated code의 일관성 검사.
6. 전체 build + integration + e2e 중 해당되는 항목 수행.
7. fail이면 `completed` 금지; 수정 횟수·추가 비용을 기록.
8. 사용자에게 최종 artifact 목록, 변경 요약, 미검증 부분 전달.


---

# 15. 비용·캐싱·관측·벤치마크

## 15.1 비용 종류를 혼합하지 말 것

| 항목 | 의미 | 실제 비용으로 주장 가능한 조건 |
|---|---|---|
| API token cost | 제공사 API 청구 단가 × 실제 과금 사용량 | 제공사 요금표/정확한 usage 확인 |
| CLI subscription usage | 개인 요금제 한도에서 소비된 사용량 | 제공사가 공개한 수치/측정 방법 있을 때만 |
| Cache write/read | API provider 캐시 비용/할인 입력 | 실제 cached token breakdown 존재 |
| Compute cost | 컨테이너 vCPU/memory/storage/network 비용 | 리소스 계측 및 클라우드 단가 반영 |
| ASO SaaS subscription | ASO 운영 서비스 이용료 | 결제사의 실제 청구 이벤트 |
| Retry/rework cost | 실패 후 반복 실행 비용 | 동일 run 내 task attempt 합산 |

`measured_cost_usd`에 구독자의 **비공개 내부 추론 단가를 임의 추정해 기록하지 않는다**. 계량 불가시 `null`과 `cost_confidence='unavailable'`로 보관.

## 15.2 작업 예산 모델

```ts
type RunBudget = {
  maxWallTimeSeconds: number;
  maxEstimatedCostUsd?: number;
  maxProviderCalls?: number;
  maxParallelTasks: number;
  maxPlanningTurns: number;
  maxRetriesPerTask: number;
  maxExternalSkillSearches: number;
  maxChangedFiles?: number;
  hardStopOnBudget: boolean;
};
```

- `maxEstimatedCostUsd`가 하드 스톱이면 실제 비용을 계측할 수 없는 연결 방식은 실행 전 별도 고지 또는 정책상 선택 불가.
- 예산 초과 예측 시 task를 새로 시작하지 않고 사용자의 상향 승인 대기.
- 안전/일관성에 필요한 rollback/clean-up 작업은 별도 예비 예산 관리.
- 러너와 서버 모두 상한 검사. UI 카운터는 안내 용도이며 enforcement는 서버/러너.
- `hardStopOnBudget`을 실시간 비용이 아닌 추정치에만 의존할 때는 정확한 제한을 보장할 수 없다는 점을 명시.

## 15.3 프롬프트 캐싱

- 모델 제공사마다 캐시 방식·유효기간·가격·모델 지원이 다르다.
- 정적 템플릿 및 변경하지 않는 시스템 지침을 prefix로 구성하되, provider별 SDK의 공식 cache semantics를 따른다.
- 매 요청에서 스킬 목록 전체를 붙여 캐시 이득을 기대하지 않는다; 인덱스만 고정 prefix로 두고 본문은 selected skill만 로드.
- 한 작업의 동적 파일 내용·사용자 요청·변경 코드가 캐시 히트를 보장하지 않는다.
- `cache_write_tokens`, `cached_input_tokens`, `uncached_input_tokens`, `cache_miss`를 가능한 범위에서 계량.
- 제공사가 캐시 사용량을 노출하지 않는다면 `cache_hit_rate=unknown`.
- 반복 호출에서 캐시 효율 향상을 측정하고, hit가 거의 없는 prefix는 최적화하지 않는다.

## 15.4 Context Budget

```yaml
context_policy:
  max_registry_summary_tokens: 1200
  max_loaded_skill_tokens_per_task:
    fast: 1500
    standard: 4500
    deep: 9000
  max_memory_retrieval_tokens: 1000
  max_source_snippets_per_task: 12
  max_subagent_result_tokens: 1200
  redact_secrets: true
```

위 값은 초기 실험 설정이며 provider context window/성능에 따라 조정한다. 품질 문제를 일으키면 필요한 증거를 제거하는 대신 더 적합한 모델/문맥 압축/작업 분할을 선택한다.

## 15.5 관측 데이터 규약

모든 실행 이벤트 및 span에 가능한 범위에서 다음 태그를 담는다.

```text
trace_id, workspace_id_hash, run_id, task_id, attempt,
provider_id, model_id, execution_mode, runtime_type,
selected_skill_digests, state, wall_ms, cpu_ms,
input_tokens, output_tokens, cached_tokens,
provider_call_count, retries, errors, quality_gate_result
```

- raw prompt, API key, auth token, GitHub private key는 log field에 저장하지 않는다.
- 민감 code diff는 hash/경로/제한된 요약만 telemetry에 저장.
- 추적 데이터와 사용자 보고 데이터의 보관 정책·동의 범위를 분리.
- OpenTelemetry trace parent-child: `Run → Refinement → Planning → Routing → Task N → Verification → Delivery`.

## 15.6 성능 대시보드

- Time: 계획/스킬 검색/모델 호출/테스트/병합/승인 대기/runner 대기를 구분.
- Cost: API 비용·클라우드 비용·예상 비용을 분리.
- Quality: acceptance success, test pass, severity, changed-files, rework.
- Platform: error rate, p50/p95 latency, WS disconnect rate, queue backlog, sandbox startup time.
- Comparison: `CLI alone A`, `All skills B`, `Adaptive ASO C` 3군.

## 15.7 벤치마크 실험 설계

### 실험군

- **A: Baseline** — 기본 Claude/Codex/Gemini CLI, 추가 ASO 정책 없음.
- **B: Naive all-skills** — 모든 관련 스킬을 무분별하게 로드하는 실험군(보안/약관 범위 내 실험).
- **C: Adaptive ASO** — 본 명세의 라우팅/예산/병렬 실행.

### 실험 통제

1. 같은 시작 commit, 같은 acceptance criteria, 같은 repo/fixtures.
2. 가능한 경우 같은 provider/model/version과 같은 환경/권한.
3. 캐시 cold/warm 실험을 분리해 기록.
4. 모델의 비결정성을 고려해 작업별 여러 번 반복하고 중앙값/분포/신뢰구간 제시.
5. 동시 네트워크 부하, provider rate-limit, 환경 변경을 기록.
6. 과제는 FAST/STANDARD/DEEP 균형 있게 배치(예: 각 10개 이상으로 시작하되 실제 유의성 검토 후 확장).
7. 실패와 재시도 비용을 포함한 end-to-end 수치로 측정.
8. 코드 리뷰는 가능하면 블라인드로 수행; 결과물 동일 기준 평가.
9. 구독 방식에서 실제 결제 비용이 안 보이면 **토큰/쿼터/시간 지표**로만 비교하고 USD 우월 주장 금지.

### 품질 평가 Rubric(100점 초기 가설)

| 항목 | 최대 점수 | 평가 방법 |
|---|---:|---|
| 기능 수용 기준 충족 | 35 | acceptance test + 사람 확인 |
| 테스트/회귀 | 20 | 단위/통합/E2E |
| 안정성·보안 | 20 | 취약점/비밀/권한 검사 |
| 코드 품질·유지관리 | 15 | 독립 리뷰 + lint/typecheck |
| 불필요 변경/사용성 | 10 | diff + UX 점검 |

- 보안상 치명적 결함은 전체 점수가 높더라도 **출시 불합격**.
- 점수 산정 코드는 `evaluationVersion`과 fixture에 고정.
- 품질과 시간·비용의 Pareto frontier를 분석하고, 한 지표만 개선된 결과를 전체 우월로 주장하지 않는다.

## 15.8 예시 벤치마크 fixture

1. FAST: React 버튼 접근성 개선 + 관련 테스트.
2. FAST: TypeScript API 타입 오류 수정.
3. STANDARD: Next.js 검색 페이지 + Fastify endpoint + pagination.
4. STANDARD: PostgreSQL migration + 권한 검증 + 회귀 테스트.
5. STANDARD: 알림 큐 재시도/멱등성 버그 수정.
6. DEEP: 모놀리식 API 모듈 분리 + integration test.
7. DEEP: 인증/RBAC 감사 및 재구현.
8. DEEP: 기존 앱을 GitHub PR 기반 워크플로로 변환.

각 fixture는 `source_repo_commit`, `task_prompt`, `acceptance_tests`, `oracle`, `evaluationVersion`을 저장한다.

# 16. 보안·권한·컴플라이언스

## 16.1 위협 모델(최소)

| 위협 | 영향 | 방어 |
|---|---|---|
| 다른 테넌트 데이터 접근(IDOR) | 코드/비밀 노출 | workspace scoping + RLS + 접근 테스트 |
| 로그에 API 키 출력 | 자격증명 유출 | Vault + redaction + raw log 제한 |
| prompt injection in repo/skill | 임의 명령/데이터 외부 반출 | untrusted boundary + command policy + sandbox |
| 러너 위조 | 사용자 파일 수정 | 기기 서명/nonce/lease/TTL |
| 외부 스킬 악성 코드 | 공급망 공격 | 출처/라이선스/해시/검토/격리 |
| 브라우저 세션 탈취 | 작업/비용 오용 | Secure HttpOnly cookie, CSRF, MFA(후속) |
| Github 설치 토큰 누출 | 저장소 권한 악용 | 단기 토큰, Vault, 로그 필터 |
| 동시 작업 충돌 | 소스 유실 | worktree, resource locks, diff review |
| 중복 작업 실행 | 이중 PR/배포/비용 | idempotency/outbox/reconciliation |
| 과도한 리소스 사용 | 비용 폭증 | rate limit, budget, concurrency caps |
| 결과물 XSS | 사용자 세션 침해 | 미리보기 sandbox origin 분리, CSP |
| SSRF 및 네트워크 외부 반출 | 내부망 접근/유출 | network egress proxy, IP/host filtering |

## 16.2 인증 및 세션

- OIDC 인증 검증: `state`, PKCE, nonce, iss, aud, exp, JWKS rotation.
- 웹 세션: HTTP-only/Secure cookie, 최소 세션 TTL, refresh rotation, account revoke.
- 관리자 민감 행동은 재인증 또는 step-up authentication.
- 서버 내부 서비스 간 인증(mTLS 또는 workload identity), 장치 공개키 인가 분리.
- OAuth 연결이 성공해도 프로젝트 실행 권한이 자동으로 부여되면 안 된다.

## 16.3 API 및 CSRF

- 입력 Zod schema validation, response escaping, CSP, strict CORS allowlist.
- 변경 요청에 CSRF 방어, Origin/Referer 검증 및 SameSite 설정.
- endpoint 별 사용자/IP/workspace rate limit + abuse detection.
- 파일 다운로드 URL은 사용 권한 재검사 후 short-lived signed URL 발급.
- webhook은 signature 검증, event ID dedupe, unknown event 처리.
- WebSocket은 Origin 검사, authenticated challenge, message size cap.

## 16.4 Prompt Injection 및 스킬 경계

- README, 문서, 코드 주석, 서드파티 스킬은 **신뢰할 수 없는 콘텐츠**.
- 외부 문서의 `ignore previous instructions`, API 키 요구, 네트워크 전송 요청은 사용자/시스템 권한을 변경할 수 없다.
- 허용된 도구 명령은 `ToolPolicyEngine`이 결정; 스킬 텍스트는 권한 부여 수단이 아니다.
- 위험도가 높은 작업은 모델 판단과 무관하게 서버+runner의 강제 게이트.
- 스킬 실행 파일은 별도 정적 검사/라이선스 검토 및 최소권한 sandbox에 격리.
- 모델 출력 JSON은 신뢰하지 않고 서버가 schema/path/limit 재검증.

## 16.5 비밀 및 데이터 보호

- 비밀 저장 시 envelope encryption, 키 교체, 접근 통제, audit.
- Vault `secret_ref`만 DB에 저장하고 평문 키는 DB에 넣지 않는다.
- 마스킹은 로그 직전뿐 아니라 예외 메시지/HTTP 에러/테스트 결과에도 적용.
- 개인 저장소 코드의 모델 전송에 대해 연결 제공사/보존/데이터 처리 조건을 고지한다.
- 고객 코드 학습에 활용한다면 별도 사전 동의와 계약이 필요하며 MVP 기본값은 학습 미사용.
- GDPR/개인정보보호법 등 적용법 판단, 국외 이전/보관 위치 등은 출시 대상국에 따라 점검.

## 16.6 공급망 정책

- 외부 스킬: origin URL, pin commit, file digest, license, dependency tree, author trust, approval reviewer 기록.
- GitHub에서 내려받은 원본 스킬은 이름만 보고 자동 승인하지 않는다.
- 모든 설치 스크립트와 hooks는 실행 전에 위험 평가.
- OSS 라이선스의 notice/저작권 표시/상업 이용 조건을 검토.
- `npm audit` 결과만으로 안전을 보장하지 않고 필요 시 SCA/secret scanning/SAST 실행.

## 16.7 개인정보 및 사용자 권리

- 사용자 데이터 내보내기, 연결 해제, 프로젝트 삭제, 계정 삭제 절차 제공.
- 법적 보존이 필요한 결제/감사 데이터는 별도 보존 기준.
- 팀 워크스페이스의 감사로그 조회 권한 제한.
- 원문 로그/모델 입력의 식별·민감 내용은 기본 최소화.
- 고객 지원용 시스템도 운영자 열람을 제한하고 접근 기록.

## 16.8 출시 보안 게이트

- [ ] 저장소 URL 입력으로 SSRF 불가능.
- [ ] 다른 워크스페이스의 프로젝트/로그/비밀 접근 불가능.
- [ ] 로컬 러너의 허용 경로 밖 파일 접근 거부.
- [ ] 취소/만료/중복 job 메시지 안전 처리.
- [ ] 위험 명령 승인 없이 실행 불가능.
- [ ] 토큰·키가 로그·SSE·diff·아티팩트에 남지 않음.
- [ ] Cloud sandbox의 internal network access 차단.
- [ ] 외부 스킬 실행/설치 공급망 검사.
- [ ] GitHub App webhook signature 및 권한 범위 확인.
- [ ] 제공사 구독 중계가 승인되지 않았으면 feature OFF.

# 17. 요금제·결제·기능 한도

## 17.1 제안 패키지 (가격 미확정)

| 플랜 | 핵심 가치 | 권장 한도 구성 |
|---|---|---|
| Free | 로컬 러너 + 기본 FAST/STANDARD 일부 | 프로젝트/월 실행 수/이력 보존 제한 |
| Pro | 고급 기획, ECC 전문가 스킬, 제한 병렬, 사용량 분석 | 월 작업 수, 동시 실행 2~3 |
| Team | 멤버/역할/공유/감사/조직 정책 | 인원·실행량·조직 보안 정책 |
| Cloud Credits | ASO 관리형 샌드박스 컴퓨팅 | CPU/메모리/시간/스토리지 사용량 |

**과금 원칙:** ASO 구독료는 오케스트레이션·도구·스토리지·협업 가치에 대한 비용. OpenAI/Anthropic/Google API 비용은 사용자의 별도 계정에서 청구되는 경우 ASO 청구서에 중복 청구하지 않는다. 원가 포함 상품을 판매할 때는 제공사별 재판매/중개 약관과 계약부터 확인.

## 17.2 Billing ledger 분리

```ts
type BillingEntry = {
  workspaceId: string;
  source: 'aso_subscription' | 'cloud_compute' | 'storage' | 'aso_addon';
  amountMinor: number;  // minimal currency unit
  currency: string;
  externalPaymentId?: string;
  idempotencyKey: string;
  occurredAt: string;
};
```

- 위 `aso_addon`은 제품 확장 슬롯 이름일 뿐, 실제 과금 전에는 정의된 별도 상품으로 치환한다.
- API usage ledger는 `billing_ledger`와 분리하고 UI에서 세금/환율/통화 처리 근거를 보여준다.
- 카드 번호 등 민감 결제정보는 직접 수집하지 않고 승인된 결제 대행사가 호스팅.
- 결제 webhook 검증, 이벤트 멱등성, 미납/환불/해지/시점별 이용권 제한 테스트.
- 국내 출시 시 통신판매업·전자상거래/전자금융/개인정보/부가세 정책을 실제 판매 구조에 맞게 검토.

## 17.3 가격 실험

- 고객군별 willingness-to-pay 및 전환율을 사전 조사.
- 실제 샌드박스 원가·지원 비용·보안 관리 비용을 측정해 무료 사용자당 상한을 설계.
- 가격을 고정하기 전 Pro/Team의 가장 지불 가치가 높은 기능을 사용성 테스트.
- 구독 연동 제공사의 API/구독 결제와 ASO 결제를 혼동시키는 UI 금지.


---

# 18. 테스트 전략과 최종 수용 기준

## 18.1 테스트 피라미드

| 범주 | 도구 | 목표 |
|---|---|---|
| Unit | Vitest | 라우터 점수, DAG, 예산, 상태머신, RBAC, DTO |
| Contract | Vitest + Zod/OpenAPI tests | FE-BE 이벤트/요청/응답 계약 |
| Integration | Testcontainers(Postgres/Redis) | queue/outbox/db/idempotency/recovery |
| Runner | 로컬 fixture + mock commands | device handshake, 경로, 권한, 프로세스 취소 |
| Provider | stubbed HTTP + mock SDK | auth/rate-limit/usage/fallback |
| Web E2E | Playwright | 가입·페어링·작업 승인·결과·연결 해제 |
| Security | SAST/DAST + 수동 레드팀 | 테넌트 분리, sandbox escape, prompt injection |
| Performance | 부하 스크립트, benchmark harness | 동시성, p95, wall-clock, 비용 |

## 18.2 필수 Unit 테스트

```text
- ambiguous request → RefinedRequest schema valid
- critical unknown → materialQuestions includes one essential question
- low complexity → FAST, high risk → verification escalation
- registry capability mismatch → skill excluded
- ECC planner and Superpowers planner → conflict resolver blocks combination
- unreviewed external skill → installation denied
- graphify absent → ordinary search fallback
- memory absent → no crash, no hallucinated memory
- dependency cycle → DAG rejected
- independent tasks → parallel eligible
- overlapping exclusiveResources → cannot run concurrently
- estimated budget exceeded → no new task scheduled
- usage unavailable → measured cost null, not zero
- invalid run transition → 409
- duplicate Idempotency-Key with different payload → 409
- approval command hash mismatch → denied
```

## 18.3 필수 Integration 테스트

```text
1. Login → create workspace → create project → create run → plan approval → mock execution → completed.
2. Approvals: approve/deny/expire; concurrency race and replay attack.
3. Runner: pairing, challenge signing, WS reconnect, wrong device ID, revoked device.
4. Queue: worker crash immediately after DB commit → outbox recovers exactly once logically.
5. Redis outage → DB state retained; retry after recovery.
6. API key connection -> vault insert -> health-check -> revoke -> key inaccessible.
7. GitHub App webhook HMAC mismatch -> 401; duplicate webhook -> idempotent.
8. Mock provider 429 -> retry after policy; auth 401 -> needs_action and no infinite retry.
9. Multi-tenant project/run/artifact IDOR tests -> 404/403.
10. Run timeout -> cancel child process and produce correct final status.
11. Local runner offline -> queue waiting; do not silently switch to cloud provider.
12. Secret string embedded in command output -> masked in SSE/log/artifact.
13. Test failure -> result partial/failed, never completed.
14. Unknown external skill source -> disabled; no auto-install.
```

## 18.4 Web E2E 핵심 스토리

- 신규 사용자가 로그인 후 로컬 러너를 페어링하고 샘플 프로젝트를 연결한다.
- 사용자가 애매한 요구를 입력하고 구체화된 완료 기준을 수정할 수 있다.
- 계획 승인 전에는 코드 변경 작업이 시작되지 않는다(선행 read-only 분석은 정책 범위 내 가능).
- 실행이 시작되면 실시간 타임라인과 로그/승인 카드가 표시된다.
- 브라우저 새로고침 후 동일 run에 재연결되어 이전 이벤트를 확인한다.
- 위험 명령 승인 거부 시 해당 작업은 실행되지 않는다.
- 완료 시 변경 파일과 실제 테스트 증거가 표시된다.
- provider 불능·러너 오프라인에서는 실행불가 이유와 복구 경로가 표시된다.
- 사용자에게 권한 없는 다른 workspace의 URL을 붙여 넣어도 정보 노출이 없다.
- 모바일에서도 실행 상태 확인 및 안전한 승인/거부 가능.

## 18.5 수용 기준 (제품 레벨)

### MVP 필수

- [ ] 회원 로그인/로그아웃, 세션 종료, 워크스페이스 소유권 검증.
- [ ] 로컬 Runner 기기 페어링 및 unpair.
- [ ] 프로젝트 생성/수정/조회/삭제.
- [ ] MockProvider를 통한 완전한 계획-실행-검증 시나리오.
- [ ] 사용자 BYOK API 키 암호화 저장/삭제 + 하나 이상의 실제 공식 API 어댑터 연결.
- [ ] FAST 모드 단일 작업 실행.
- [ ] 요구 고도화 + 수용기준 표시 + 계획 승인.
- [ ] SSE 이벤트 stream 및 재연결 replay.
- [ ] 파일 변경 요약 + 실제 테스트 결과 표시.
- [ ] 취소/만료/오류를 정확히 표시.
- [ ] 프로젝트 간 데이터 격리.
- [ ] 인증키/비밀이 로그와 응답에 노출되지 않음.

### 확장 단계 필수

- [ ] GitHub App 최소권한 연동 + branch/PR 생성.
- [ ] STANDARD/DEEP 모드 계획 및 스킬 라우팅.
- [ ] DAG 동시성, worktree 격리, 충돌 탐지.
- [ ] ECC specialist 선택 로딩 및 충돌 정책.
- [ ] Cloud Sandbox 격리와 네트워크 정책 검증.
- [ ] 비용·캐시·재시도 사용량 대시보드.
- [ ] A/B/C 벤치마크 재현 가능한 결과.
- [ ] Pro/Team/결제 원장과 webhook 테스트.
- [ ] 정책상 허용/승인된 모델 구독 연동만 노출.

### 보안/품질 배포 차단 조건

- P0/P1 보안 이슈 미해결.
- 타 테넌트 접근 취약점 존재.
- 사용자의 승인 없는 destructive action 가능.
- 테스트 실패를 성공으로 위장.
- provider subscription credential scraping 또는 중계.
- 키나 토큰이 로그·GitHub PR·아티팩트에 노출.
- 사용량 통계가 실제 계량과 불일치하는데 실측치로 표기.

# 19. 로컬 개발, CI/CD, 배포 및 운영

## 19.1 개발 전 요구사항

- Node.js LTS 및 패키지 매니저 버전 고정(`.node-version`, `packageManager`).
- Docker/Container Runtime; PostgreSQL, Redis, S3-compatible 개발 스토리지.
- GitHub App은 로컬 Mock을 우선 사용. 외부 연동이 필요한 단계에서 실제 자격증명 설정.
- MockProvider가 인터넷 없이도 개발/테스트/데모를 지원해야 한다.
- 테스트용 저장소 fixture는 개인의 기밀 코드와 분리.

## 19.2 개발 명령 인터페이스(구현할 스크립트)

```bash
pnpm install --frozen-lockfile
pnpm infra:up          # docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev               # web + api + worker (mock mode)
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm benchmark:mock
pnpm build
pnpm verify
```

**주의:** 위 명령은 목표 CLI 계약이다. 현재 존재하는 스크립트가 아니므로 `package.json`과 구현을 함께 작성해야 한다.

## 19.3 `infra/compose.yaml` 개발 예시

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: aso
      POSTGRES_PASSWORD: aso_dev
      POSTGRES_DB: aso_dev
    ports: ['127.0.0.1:5432:5432']
    volumes: ['aso_pg:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U aso -d aso_dev']
      interval: 5s
      retries: 20
  redis:
    image: redis:7-alpine
    ports: ['127.0.0.1:6379:6379']
    volumes: ['aso_redis:/data']
    command: ['redis-server', '--appendonly', 'yes']
  minio:
    image: minio/minio
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: localdev
      MINIO_ROOT_PASSWORD: localdev-only-password
    ports: ['127.0.0.1:9000:9000', '127.0.0.1:9001:9001']
    volumes: ['aso_minio:/data']
volumes:
  aso_pg:
  aso_redis:
  aso_minio:
```

- 위 컨테이너 태그는 개념 예시. 구현 시 보안 패치가 포함된 digest 고정 이미지로 배포.
- `localhost` 포트 노출과 개발 비밀번호는 **프로덕션에서 절대 사용 금지**.
- 로컬 객체 스토리지 버킷 생성 스크립트 별도 작성.
- MinIO/패키지 이미지는 해당 버전의 환경 및 볼륨 경로 호환성을 검증.

## 19.4 CI 파이프라인

```text
PR
 ├─ lockfile/format/lint/typecheck
 ├─ unit/contract tests
 ├─ integration tests with Postgres/Redis
 ├─ Next.js production build
 ├─ dependency / secrets / SAST checks
 ├─ sample runner package build
 └─ (protected branch) migration dry-run and e2e smoke
```

- 다른 개발자의 PR에서 생성된 코드를 신뢰할 수 없으므로 CI secret 노출 주의.
- 외부 PR의 GitHub Actions에 배포 키/실제 API 키 전달 금지.
- provider 실 API 통합 테스트는 별도 격리된 승인 파이프라인에서 제한적으로 수행.
- 릴리스 산출물의 sha256/SBOM/signature를 저장.

## 19.5 상용 배포 분리

- `web`: 서버리스/Node hosting 등 UI 계층.
- `api`: WebSocket+SSE 지원되는 long-running service.
- `worker`: queue consumers + scheduler leader election.
- `db`: managed PostgreSQL (backup/PITR).
- `redis`: managed service (메모리 용량/영속성 설정).
- `artifact storage`: private bucket + lifecycle.
- `cloud sandbox`: 별도 격리 실행 풀, private network.
- `secrets`: KMS/Secret Manager.
- `observability`: metrics/tracing/logging with redaction.

**운영 경계:** Vercel 같은 프론트엔드 배포 플랫폼에 긴 실행·로컬 터미널 프로세스·WS runner를 같은 서버리스 함수로 억지로 넣지 않는다. 독립적인 Worker/API 실행 환경을 둔다.

## 19.6 운영 필수 Runbook

1. Runner 연결 장애: pairing/key/status/WS 원인별 점검.
2. Redis outage: queue 정지, outbox backlog, 복구 후 중복 확인.
3. DB 장애: API read-only/fail closed, 재시도, PITR.
4. Provider 429/인증 장애: failover 정책·사용자 알림.
5. 비용 급증: workspace/계정 rate limit, kill switch.
6. 유출 의심: 비밀 rotation, device revoke, token invalidate, 사고 대응.
7. 악성 스킬 발견: registry digest denylist, 실행 중지, 영향받은 run 식별.
8. GitHub 권한 철회: installation token 폐기 및 진행 중 작업 취소/중단.
9. 서비스 해지/데이터 삭제: 비밀 파기, 저장 artifact lifecycle, 증빙.
10. 신규 제공사 약관 변경: connection mode gate를 서버에서 즉시 내리는 절차.

# 20. 단계별 구현 백로그 (에이전트 실행 지시)

## Phase 0 — 환경 조사·리스크 확정·계약 고정

**입력:** 본 문서, 기존 CLI ASO 명세, 현재 git repo.

**작업:**

1. 기존 코드·폴더·`CLAUDE.md`, `AGENTS.md`, `GEMINI.md` 및 스킬 설치 상태 확인.
2. 언어·버전·패키지 manager·DB/queue/cloud 비용 제약 탐지.
3. 제공사 인증 경계와 feature flags를 `docs/adr/`에 명시.
4. 가장 작은 수직 슬라이스를 선택: `로그인 → 프로젝트 → MockProvider Run → 실시간 결과`.
5. OpenAPI/Zod 계약, Run 상태 머신, 파일 책임 ownership 확정.
6. 미확정 사항을 `docs/DECISIONS.md`의 `ASSUMPTION`/`BLOCKER`로 분리.

**산출:** ADR 0~10, repo 계획, risks, 테스트 fixture.

**완료 기준:** 불명확한 기능은 명확히 OFF로 설정되었고 사용자의 기존 설정을 무단 변경하지 않았다.

## Phase 1 — Monorepo + 핵심 인프라 + MockProvider

**작업:**

1. pnpm workspaces/Turborepo, web/api/worker/local-runner scaffold.
2. TypeScript strict, lint/format/test/build 설정.
3. PostgreSQL+Redis+local S3 compose.
4. DB users/workspaces/projects/runs/events/tasks migrations.
5. `MockProvider.execute()`가 deterministic fixture와 이벤트를 반환.
6. `pnpm dev`, `pnpm test`, `pnpm build` 정상 동작.

**완료 기준:** 로컬에서 단일 명령으로 mock 전체 스택 기동, 샘플 run 생성 후 결과 조회.

## Phase 2 — 로그인·프로젝트·Run UI + SSE

**작업:**

1. 로그인/세션/워크스페이스 소유권 확인.
2. 프로젝트 CRUD 및 UI.
3. Run 생성 API/상태 머신/outbox/events.
4. W03~W09 최소 UI와 SSE streaming/replay.
5. 계획/승인 UI, 취소/timeout 표시.
6. 모바일 기본 반응형과 접근성 검사.

**완료 기준:** Playwright에서 로그인 → 새 프로젝트 → 요구 입력 → Mock Run → 테스트 증거 확인 흐름 통과.

## Phase 3 — Local Runner + Device Pairing

**작업:**

1. CLI scaffold, Ed25519 key, pair/unpair.
2. outbound WS, challenge/response, heartbeat, reconnect.
3. workspace 경로 grant, sandbox/worktree 정책.
4. signed job contract, allowlist, 명령 승인·취소.
5. 내 PC에서 mock code update/test 실행.
6. 실제 Codex local adapter는 별도 기능 게이트와 공식 문서 확인 후 연결.

**완료 기준:** 읽기/쓰기 허용된 샘플 폴더에서만 변경; 경로탈출/재사용/서명 위조 테스트 모두 거부.

## Phase 4 — BYOK API + Orchestrator MVP

**작업:**

1. Vault/암호화 연결 관리, 키 검증/삭제.
2. OpenAI API 공식 adapter 우선 1개, 이후 Anthropic/Google BYOK.
3. Intent Refiner와 acceptance criteria.
4. FAST/STANDARD 분류와 짧은 계획.
5. Skill Registry (메타데이터 인덱스) + provenance lock.
6. `superpowers` 일부 workflow를 인터페이스로 감싸고, 경량 개발 원칙 적용.
7. 모델 실패·rate limit·usage 정규화.

**완료 기준:** 한 가지 공식 API provider와 샘플 저장소에서 최소 1개 실제 변경사항 생성 및 테스트 통과.

## Phase 5 — GitHub App + PR 흐름

**작업:**

1. GitHub App 설치/권한/저장소 선택 UI.
2. 설치 토큰/웹훅 검증.
3. 선택 repo checkout, 새 브랜치와 patch.
4. PR draft 생성 전 diff/secret scan/사용자 승인.
5. GitHub 연결 철회 처리 및 리소스 취소.

**완료 기준:** 별도 테스트 GitHub repo에서 read → branch → 변경 → 검사 → 승인 → draft PR end-to-end.

## Phase 6 — Adaptive DAG + 스킬 전문성 확장

**작업:**

1. DAG planner, cycle validation, resource locks.
2. Scheduler worker lease/retry/outbox recovery.
3. 독립된 작업만 worktree 병렬 실행.
4. ECC specialist skill 선택적 로딩, 충돌 정책.
5. find-skills는 capability gap일 때만.
6. Graphify/claude-mem은 존재 확인 후 조건부 연동.
7. DEEP mode, 독립 검증, 자동 재작업 최대치.

**완료 기준:** 인위적 충돌 fixture에서 동시 수정 실패를 방지하고, 독립 작업 fixture에서는 실측 시간이 개선되는지 확인.

## Phase 7 — Cloud Sandbox / 보안 하드닝

**작업:**

1. ephemeral non-root container runner.
2. egress 제한·SSRF/internal metadata 차단.
3. CPU/memory/time/secret mount 제한.
4. GitHub checkout/patch/PR integration.
5. artifact private storage / presigned URLs.
6. threat model 검증과 penetration test.

**완료 기준:** 악성 repo/스킬 fixture로 sandbox escape, secret exfiltration, 네트워크 우회 차단 검증. 실패 시 feature OFF 유지.

## Phase 8 — Observability / Benchmark / Billing

**작업:**

1. token/cost/cache/latency/quality telemetry.
2. baseline vs all-skills vs adaptive 자동 실험.
3. Run 결과별 상세 지표 UI.
4. 조합 성과 기반 skill selection 보정(오프라인).
5. Free/Pro/Team entitlement server enforcement.
6. 결제사 webhook ledger/환불/해지(판매 국가·사업자 조건 확정 후).
7. 모니터링/운영 runbook/alert.

**완료 기준:** 각기 다른 비용 출처가 명확히 구분되며, 근거 없는 토큰 비용/품질 개선 수치 없음.

## 20.1 Phase 간 의존성

```mermaid
flowchart TD
  P0[Phase 0 Contracts] --> P1[Phase 1 Infra+Mock]
  P1 --> P2[Phase 2 Web UX]
  P1 --> P3[Phase 3 Local Runner]
  P2 --> P4[Phase 4 BYOK/Orchestrator]
  P3 --> P4
  P4 --> P5[Phase 5 GitHub]
  P4 --> P6[Phase 6 Adaptive DAG]
  P5 --> P7[Phase 7 Sandbox]
  P6 --> P7
  P7 --> P8[Phase 8 Benchmark/Billing]
```

엄밀한 제품 우선순위는 `P0→P1→P2/3→P4`이며, 그 이후 GitHub·DAG는 사용자 테스트 우선순위에 따라 일부 병렬 개발 가능. 단, 공개 보안 경계는 우회 불가.

## 20.2 구현 작업 티켓 포맷

각 티켓은 다음 필드를 필수로 포함:

```yaml
id: ASO-API-001
title: Run 생성 API 및 멱등성 보장
phase: 2
owner_package: apps/api
dependencies: [ASO-DB-003]
capabilities: [typescript, fastify, postgres, idempotency]
allowed_paths: [apps/api/src/routes/runs/**, packages/contracts/src/runs/**]
acceptance:
  - 중복 Idempotency-Key + 동일 요청은 같은 run 반환
  - 동일 키 + 다른 payload는 409
  - 다른 workspace는 조회 불가
  - DB transaction + outbox commit
  - test:integration 통과
risk: medium
permissions:
  network: false
  git_push: false
  deployment: false
```

에이전트는 각 Phase를 `티켓 → 구현 → 테스트 → 요약 → 다음 티켓` 순서로 수행하고 범위를 임의로 확장하지 않는다.

# 21. Claude Code / Codex / Gemini CLI용 구현 지시문

## 21.1 공통 시스템 에이전트 계약

다음 파일 내용이 프로젝트의 실행 원칙이다.

- `AGENTS.md`: 공통 요구와 프로젝트 구조·테스트 명령.
- `CLAUDE.md`: Claude Code에서 `docs/ASO_WEB_APP_SPEC.md`와 `AGENTS.md`를 읽도록 안내.
- `GEMINI.md`: Gemini CLI에서 동일한 파일을 읽도록 안내.

원칙: 문서 전체 내용을 세 파일에 복사하지 말 것. 한 곳의 **원본 명세**를 얇은 지침에서 참조.

### `AGENTS.md` 예시

```markdown
# Project Agent Instructions

Read `docs/ASO_WEB_APP_SPEC.md` before planning or editing code.

Implementation priorities:
1. Safety, policy compliance, tenant isolation, and user data preservation.
2. Working end-to-end vertical slices with real tests.
3. The smallest relevant skill/context set.
4. Measured quality, time, and cost improvements.

Work phase by phase from the implementation backlog.
Before each change, inspect existing repository state.
Do not overwrite user settings or install third-party hooks without approval.
Do not implement unapproved AI subscription token forwarding.
Distinguish mocks, planned functionality, and real working integrations.

For each completed phase provide:
- changed files
- commands executed and exit codes
- tests passed/failed
- unresolved blockers
- next phase
```

### `CLAUDE.md` 예시

```markdown
# Claude Code Project Guide

Follow `AGENTS.md` and `docs/ASO_WEB_APP_SPEC.md`.
Use Superpowers/ECC only when local skill registry and stage policy select them.
Do not activate duplicate global planning/memory hooks.
Preserve existing work and verify actual changes before claiming success.
```

### `GEMINI.md` 예시

```markdown
# Gemini CLI Project Guide

Follow `AGENTS.md` and `docs/ASO_WEB_APP_SPEC.md`.
Use supported official APIs and authentication flows.
Never extract/piggyback on Gemini CLI OAuth credentials for third-party inference.
Implement validated phases, record tests, and report honest failures.
```

## 21.2 신규 프로젝트용 최초 구현 프롬프트

아래 내용을 CLI에 입력한다.

> `docs/ASO_WEB_APP_SPEC.md`를 전체적으로 읽어라. 현재 저장소와 기존 ASO CLI 엔진이 있다면 분석하되, 없으면 새 모노레포를 생성하라. Phase 0에서 사실/가정/정책 리스크와 구현 환경을 확인하고, Phase 1의 실행 가능한 최소 vertical slice를 구현하라. 우선 MockProvider를 사용해 로그인·프로젝트·Run·SSE·결과 확인 중 가장 작은 경로부터 작동시켜라. 내가 제공하지 않은 API 키나 사업자 계약을 있다고 가정하지 마라. 외부 구독 토큰 수집 또는 재판매 기능은 만들지 마라. 각 Phase 종료마다 빌드·typecheck·테스트 실제 결과와 변경 파일을 보고하고, 다음 Phase로 넘어가기 전에 문서의 완료 기준을 확인하라. 모호하지만 합리적인 기술 선택은 가정을 기록하고 진행하되, 보안·결제·실데이터 삭제 같은 불가역 사항만 질문하라.`

## 21.3 이미 존재하는 ASO CLI 엔진을 웹으로 전환할 때

> `docs/ASO_WEB_APP_SPEC.md`와 기존 `docs/ASO_ENGINE_SPEC.md`를 함께 읽어라. 기존 엔진의 intent, router, scheduler, budget, memory adapter를 가능한 범위에서 `packages/aso-core`, `packages/scheduler`, `packages/provider-adapters`로 추출하여 재사용하라. CLI의 호스트별 실행 명령·로컬 파일 권한은 `apps/local-runner` 경계로 이동하라. 웹에서 직접 CLI 프로세스를 실행하지 마라. 기존 기능을 제거/변경하기 전에 테스트를 작성하고 Phase별로 마이그레이션하라. 원본 CLI 사용 방식도 회귀 테스트로 유지하라.

## 21.4 단계별 완수 보고서 포맷

```markdown
## Phase N Implementation Report

### 구현된 기능
- ...

### 실제 변경 파일
- path/to/file.ts — 목적

### 검증
| Command | Exit Code | Result |
|---|---:|---|
| pnpm typecheck | 0 | PASS |
| pnpm test | 0 | PASS |
| pnpm build | 0 | PASS |

### 보안/권한 영향
- ...

### 미구현 및 차단된 기능
- e.g. Partner OAuth: 공식 파트너 승인 전까지 OFF

### 실제 측정치
- unit/e2e 통과 수, elapsed time, tokens (if available)

### 다음 단계
- ...
```

실행하지 않은 테스트를 `PASS`라고 기록해서는 안 된다. `exit code 0`은 실제 로그/CI 기록으로만 기입한다.

# 22. 위험 등록부·결정 필요 사항·출시 게이트

## 22.1 Risk Register

| ID | 위험 | 영향 | 대응 | 우선순위 |
|---|---|---|---|---|
| R01 | 모델 구독 연동 약관 불확실성 | 기능 중단/계정 제재 | BYOK 기본, OAuth feature gate, 법률 검토 | Critical |
| R02 | 에이전트 임의 명령 실행 | 로컬 파일 손실/유출 | Runner grant + approval + sandbox | Critical |
| R03 | 다중 테넌트 누출 | 고객 소스코드 노출 | RBAC + RLS + IDOR tests | Critical |
| R04 | 스킬 공급망 악성 코드 | 시스템 침해 | pin digest/승인/격리 | Critical |
| R05 | 병렬 병합 재작업 | 속도/품질 악화 | DAG 계약 + ownership + worktree | High |
| R06 | 토큰 비용/한도 불투명 | 오해/예산 초과 | 계량 가능한 값만 표시 | High |
| R07 | 외부 제공사 장애 | 작업 실패 | policy-aware retry + pause | High |
| R08 | 러너 오프라인/중단 | 사용자 불편 | heartbeat + recover + cancel | Medium |
| R09 | 스킬 중복 자동 실행 | 컨텍스트 증가 | 단일 오케스트레이터 + conflict groups | High |
| R10 | 경쟁 서비스 대비 차별성 부족 | 유료 전환 저하 | A/B/C 검증 + UX 관찰 | High |
| R11 | 클라우드 실행 원가 폭증 | 수익 악화 | quotas + runtime caps + metering | High |
| R12 | 고객 데이터 법적/규제 문제 | 서비스 위험 | 데이터 최소화·국가별 법률 검토 | High |

## 22.2 최종 제품 결정 중 미확정 항목

1. 서비스 이름/도메인/상표(ASO Web은 작업명).
2. 국내 중심 또는 해외 동시 출시 여부(결제사·세금·법률에 영향).
3. 초기 사용자층: 개발자 중심인지 비개발자까지 포함하는지.
4. 초기 실행 모드: 로컬 전용 / BYOK 클라우드까지 동시 지원.
5. 상용 보안·법률 검토 담당자.
6. 연결할 실제 제공사 계약/승인 범위.
7. 클라우드 인프라 제공자와 예상 예산.
8. 데이터 보존 기간과 고객 코드의 AI 제공사 전송에 대한 정책.
9. Free/Pro/Team 실제 가격 및 사용 한도.
10. 기존 CLI 엔진 코드가 있는지, 명세서만 있는지.

**진행 규칙:** 미확정 항목이 있어도 Phase 0~2의 mock MVP는 가정을 명시하고 계속 개발. 계정과금/구독 중계/운영 배포처럼 위험한 부분만 정식 결정 전 진행 금지.

## 22.3 Go / No-Go 체크포인트

### 개발자 Private Alpha

- Mock end-to-end 성공, 인증/RBAC 검증, 로컬 실행기 권한 분리, 감사 로그.
- 적어도 1개 실제 provider API 연결은 운영 키로 검증하되 키가 로그에 나타나지 않음.
- 실제 결과물/테스트 증거 UI 제공.

### Public Beta

- 주요 보안 취약점 조치, 자동 복구·재시도, GitHub 권한 검사, 과금 관련 고지.
- 테스트 사용자 프로젝트에서 작업 재현 가능.
- 청구 비용의 출처와 미측정 영역을 구별.
- 정책 불명확 제공사 연동은 disabled.

### Commercial GA

- 상업 약관/개인정보 처리/결제/고객지원/보안 대응 확정.
- SLA·백업·복구·사고 대응 문서화.
- 충분한 A/B/C 벤치마크와 공개 가능한 결과만 마케팅에 사용.
- 공급망/러너 배포 서명과 업데이트 절차 완비.

# 23. 공식 참고문서 및 검증 출처

> 아래 URL은 개발 시 최신 내용을 확인할 **공식 문서 중심의 참조 링크**다. 2026-11-04에 확인한 내용은 이후 변경될 수 있다. 구현 도중 공식 SDK 명칭, OAuth scope, CLI 플래그, 요금, 제공사 정책이 달라졌다면 문서보다 최신 공식 계약을 우선한다.

## 23.1 OpenAI 및 Codex

- Sign in with ChatGPT: https://developers.openai.com/siwc/website
- Partner availability/quickstart: https://developers.openai.com/siwc/quickstart
- Sign in with ChatGPT for open-source harnesses: https://developers.openai.com/siwc/token-sharing-open-source
- Codex app-server OAuth integration: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- Codex platform integration options (SDK/app-server/exec): https://developers.openai.com/blog/codex-as-a-platform
- ChatGPT 계획에서 Codex 사용: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- 참여 앱에서 ChatGPT 구독 사용: https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites

## 23.2 Anthropic 및 Claude Code

- Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Claude Code docs: https://code.claude.com/docs/en/overview
- Claude Agent SDK docs: https://platform.claude.com/docs/en/agent-sdk/overview

## 23.3 Google 및 Gemini CLI

- Gemini CLI OAuth/third-party FAQ: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md
- Gemini CLI terms and privacy: https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
- Gemini CLI headless docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
- Gemini CLI SDK implementation status: https://github.com/google-gemini/gemini-cli/blob/main/packages/sdk/SDK_DESIGN.md

## 23.4 GitHub 및 개발 플랫폼

- GitHub App vs OAuth App: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- GitHub App docs: https://docs.github.com/en/apps
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP LLM Top 10: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OpenTelemetry: https://opentelemetry.io/docs/
- PostgreSQL docs: https://www.postgresql.org/docs/

## 23.5 스킬 원천 후보(설치 전 검증)

- ECC: https://github.com/affaan-m/ECC
- Superpowers: https://github.com/obra/superpowers
- claude-mem: https://github.com/thedotmack/claude-mem
- Ponytail: https://github.com/DietrichGebert/ponytail
- Matt Pocock skills: https://github.com/mattpocock/skills
- Graphify: https://github.com/Graphify-Labs/graphify

`andrej-karpathy-skills`, `find-skills`, `prompt caching skill`은 동일 이름의 다양한 배포판이 존재할 수 있으므로 사용자가 실제 설치한 저장소의 원본 URL을 먼저 확인하고 lock에 반영한다. **현재 이름만으로 특정 저작권·공식성을 확정하지 않는다.**

# 24. 부록 — 바로 구현할 계약 및 예시 코드

## 24.1 API 타입 공유 예시

`packages/contracts/src/runs.ts`

```ts
import { z } from 'zod';

export const BudgetSchema = z.object({
  maxWallTimeSeconds: z.number().int().min(30).max(86400).default(1800),
  maxEstimatedCostUsd: z.number().nonnegative().optional(),
  maxParallelTasks: z.number().int().min(1).max(8).default(1),
  hardStopOnBudget: z.boolean().default(true),
});

export const CreateRunSchema = z.object({
  request: z.string().trim().min(3).max(30000),
  runtime: z.enum(['local', 'cloud']),
  executionMode: z.enum(['auto', 'fast', 'standard', 'deep']).default('auto'),
  providerPreference: z.string().min(1).default('auto'),
  budget: BudgetSchema,
  options: z.object({
    requirePlanApproval: z.boolean().default(true),
    allowExternalSkills: z.boolean().default(false),
    createPullRequest: z.boolean().default(false),
  }),
});

export type CreateRunInput = z.infer<typeof CreateRunSchema>;
```

주의: API에서 `runtime: cloud`가 현재 기능 플래그 OFF이면 schema가 유효하더라도 서비스 정책 검사에서 `FEATURE_NOT_ENABLED`를 반환한다.

## 24.2 정책 게이트 예시

`packages/security/src/provider-policy.ts`

```ts
export type ProviderFeature =
  | 'openai.byok'
  | 'openai.local'
  | 'openai.partner-oauth'
  | 'anthropic.byok'
  | 'anthropic.local'
  | 'google.byok'
  | 'google.local';

export type PolicyState = {
  enabled: boolean;
  reviewedVersion: string;
  reason: string;
};

export function enforceFeature(
  feature: ProviderFeature,
  policy: Readonly<Record<ProviderFeature, PolicyState>>,
): void {
  const state = policy[feature];
  if (!state?.enabled) {
    throw Object.assign(new Error('Provider feature is not enabled'), {
      code: 'PROVIDER_POLICY_DISABLED',
      feature,
      reason: state?.reason ?? 'No policy decision',
    });
  }
}
```

테스트: `openai.partner-oauth=false`, `anthropic.local=false`, `google.local=false`일 때 API/UI/Worker 세 계층에서 동일하게 거부되어야 한다.

## 24.3 MockProvider 예시

`packages/provider-adapters/src/mock.ts`

```ts
import type { AgentTaskRequest, AgentTaskResult } from './types';

export class MockProvider {
  readonly id = 'mock' as const;
  readonly runtime = 'api' as const;

  async checkConnection() { return { ready: true }; }
  async listCapabilities() { return ['plan', 'code', 'review']; }

  async execute(task: AgentTaskRequest, signal: AbortSignal): Promise<AgentTaskResult> {
    if (signal.aborted) throw new Error('ABORTED');
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: `[Mock] ${task.goal}`,
      changedFiles: [],
      artifacts: [],
      tests: [{ command: 'mock:verify', exitCode: 0, passed: true }],
      usage: { source: 'mock', inputTokens: 0, outputTokens: 0 },
      warnings: ['Mock execution does not edit real files or call a model.'],
    };
  }
}
```

- 위 코드는 Mock 단계의 흐름 테스트 전용이다. 실제 작업물을 만든 것이 아니므로 UI의 완료 상태에 `Demo / Mock` 표시 필요.
- 실제 provider는 별도의 ToolExecutor와 Sandbox 검증을 거쳐 파일을 수정하며, 결과 JSON만으로 코드가 수정되었다고 주장하면 안 된다.

## 24.4 서버 Run 생성 핸들러 의사코드

```ts
async function createRunHandler(req: AuthenticatedRequest, reply: FastifyReply) {
  const input = CreateRunSchema.parse(req.body);
  await requireWorkspaceRole(req.user.id, req.params.workspaceId, ['owner','admin','developer']);
  const project = await getProjectScoped(req.params.workspaceId, req.params.projectId);
  await enforceRuntimeAndProviderPolicy(input, project);
  await enforceWorkspaceQuota(req.params.workspaceId, input);

  const idempotencyKey = parseRequiredIdempotencyKey(req.headers);
  const result = await db.transaction(async tx => {
    const replay = await checkIdempotency(tx, req.params.workspaceId, idempotencyKey, input);
    if (replay) return replay;
    const run = await insertRun(tx, req, project, input);
    await appendEvent(tx, run.id, 'run.created', {});
    await insertOutbox(tx, 'run.start', { runId: run.id });
    await saveIdempotentResult(tx, req.params.workspaceId, idempotencyKey, input, run);
    return run;
  });
  return reply.code(202).send({ runId: result.id, status: result.status });
}
```

이 함수는 **구현 의사코드**다. `AuthenticatedRequest`, `getProjectScoped`, `insertOutbox` 등 실제 모듈 구현과 인증/DB 트랜잭션 경계는 개발 작업에 포함한다.

## 24.5 서버와 Local Runner의 책임에 관한 불변 테스트

```ts
// Pseudocode for security property tests
it('never runs arbitrary shell commands in web/api', () => {
  expect(API_RUNTIME).not.toImport('node:child_process');
});

it('never accepts unsigned job offers', async () => {
  const result = await runner.receiveJob({ signature: 'invalid' });
  expect(result).toMatchObject({ accepted: false });
});

it('never opens a path outside the user grant', async () => {
  const result = await runner.tryRead('../../.ssh/id_rsa');
  expect(result).toMatchObject({ allowed: false });
});
```

모듈 구조 테스트는 정적 analysis/ESLint dependency rules로 구현하고, 경로 탈출은 실제 파일시스템 fixture 테스트로도 검증.

## 24.6 첫 10개 티켓 생성 목록

| ID | 제목 | 선행 |
|---|---|---|
| ASO-001 | Monorepo + common scripts + strict TS | 없음 |
| ASO-002 | Database migration + DB seed | ASO-001 |
| ASO-003 | Contracts/Zod/OpenAPI build | ASO-001 |
| ASO-004 | MockProvider + ASO core interfaces | ASO-003 |
| ASO-005 | Auth + workspace RBAC | ASO-002, ASO-003 |
| ASO-006 | Project CRUD scoped by workspace | ASO-005 |
| ASO-007 | Run create + idempotency + outbox | ASO-004, ASO-006 |
| ASO-008 | Worker consume + mock pipeline + events | ASO-007 |
| ASO-009 | SSE with Last-Event-ID replay | ASO-008 |
| ASO-010 | Web project/run dashboard + Playwright happy path | ASO-006, ASO-009 |

각 티켓마다 acceptance 테스트와 실제 실행 로그를 추가한 뒤 다음으로 진행한다.

## 24.7 초기 화면 컴포넌트 목록

```text
components/
  layout/AppShell.tsx
  layout/WorkspaceSwitcher.tsx
  layout/Sidebar.tsx
  projects/ProjectCreateWizard.tsx
  projects/ProjectCard.tsx
  runs/RunComposer.tsx
  runs/RefinedRequirements.tsx
  runs/PlanReview.tsx
  runs/TaskDagView.tsx
  runs/RunTimeline.tsx
  runs/TaskCard.tsx
  runs/ApprovalDialog.tsx
  runs/RunDiffViewer.tsx
  runs/TestEvidencePanel.tsx
  runs/RunUsageSummary.tsx
  providers/ProviderConnectionCard.tsx
  providers/ApiKeyConnectForm.tsx
  runners/RunnerPairingWizard.tsx
  runners/RunnerHealthCard.tsx
  skills/SkillCatalog.tsx
  skills/SkillSelectionExplanation.tsx
  usage/UsageBreakdown.tsx
  benchmarks/BenchmarkComparison.tsx
  billing/PlanComparison.tsx
  common/AsyncState.tsx
  common/EmptyState.tsx
  common/ErrorMessage.tsx
  common/PermissionBadge.tsx
```

- UI 상태: `idle`, `loading`, `empty`, `success`, `stale`, `error`, `permission_required`, `offline`.
- ProviderConnectionCard에서 허용하지 않은 OAuth 연결을 노출하지 않는다.
- 각 컴포넌트의 상태에 대한 Storybook/시각적 테스트는 M1 이후 도입 가능.

## 24.8 운영 관측 메트릭 명명 규칙

```text
aso_run_created_total{mode,runtime}
aso_run_completed_total{mode,runtime,status}
aso_run_duration_seconds{mode,runtime}
aso_task_duration_seconds{stage,provider}
aso_task_retries_total{reason}
aso_runner_connections_active
aso_runner_ws_disconnects_total{reason}
aso_queue_depth{queue}
aso_approval_pending_total{risk}
aso_skill_selected_total{skill_id}
aso_provider_error_total{provider,error_class}
aso_provider_input_tokens_total{provider,model}
aso_provider_output_tokens_total{provider,model}
aso_provider_cached_tokens_total{provider,model}
aso_cloud_cpu_seconds_total
aso_tenant_scope_denials_total{resource}
```

`workspace_id`, `run_id`를 Prometheus 등 high-cardinality metrics label로 무한 저장하지 말고 tracing/log context에서 관리.

## 24.9 데이터 보호용 UI 문구 예시

**로컬 실행 모드 안내:**

> 이 모드에서는 코드 실행과 파일 변경이 사용자가 허용한 컴퓨터의 작업 폴더에서 수행됩니다. 프로젝트의 일부 내용은 선택한 AI 모델로 전달될 수 있습니다. 모델 사용 요금과 사용 한도는 연결 방식 및 각 제공사 계약에 따릅니다.

**개인 API 키 연결 안내:**

> API 키는 사용자 본인의 모델 제공사 계정에 연결됩니다. AI API 사용료는 해당 제공사에서 별도로 청구될 수 있습니다. ASO 서비스 구독료와 별개이며, 비밀 키는 연결 화면에 다시 표시되지 않습니다.

**파트너 구독 연동 미지원 안내:**

> 현재 이 서비스에서 해당 제공사의 기존 구독 사용량을 직접 연결하는 기능은 지원하지 않습니다. 제공사 정책 및 정식 승인 여부에 따라 추후 지원 범위가 달라질 수 있습니다. 우선 개인 API 키 또는 제공되는 로컬 실행 방법을 사용할 수 있습니다.

**실패/부분 완료 안내:**

> 일부 구현 결과는 생성되었지만 필수 테스트 또는 완료 기준을 모두 통과하지 못했습니다. 실패 항목과 변경 코드를 확인한 뒤 다시 실행할 수 있습니다.

---

# 25. 최종 구현 원칙·최종 인수 체크리스트

## 25.1 품질 우선순위

```text
(1) 법적/계약적 허용 범위, 안전, 고객 코드/데이터 보호
(2) 사용자가 요청한 기능의 정확성과 실테스트
(3) 시스템 복구성, 추적 가능성, 유지보수성
(4) 사용자 경험과 완료시간
(5) 실측된 비용 최적화
```

시간·토큰을 줄이겠다는 이유로 인증/권한/안전 검증을 제거할 수 없다.

## 25.2 최종 데모에서 반드시 가능한 일

1. 새 사용자가 로그인할 수 있다.
2. 워크스페이스와 프로젝트를 만든다.
3. 사용자 PC의 Local Runner를 안전하게 페어링하거나 BYOK를 등록한다.
4. 자연어로 개발 요청을 제출한다.
5. AI가 요청을 구조화하고, 가정과 수용기준을 보여준다.
6. 사용자가 계획과 위험 권한을 확인한다.
7. 작업은 선택된 모델/스킬/러너로 실행되고 상태가 실제로 갱신된다.
8. 허용된 범위에서만 파일이 변경된다.
9. 결과의 실제 테스트 기록과 Git diff를 확인한다.
10. 비용/사용량에 어떤 정보가 측정되었고 무엇이 미확인인지 명확히 본다.
11. 사용자가 취소, 연결 해제, 프로젝트 삭제를 수행할 수 있다.
12. 승인되지 않은 구독 토큰 우회 및 무허가 명령 실행은 불가능하다.

## 25.3 AI 개발 에이전트에 대한 종료 지침

- '스펙 작성'은 '구현 완료'가 아니다.
- 코드, 실제 테스트, UI, 문서, 환경 변수 예시, 마이그레이션을 모두 포함해야 한 Phase가 완료된다.
- 오류가 발생하면 오류 로그와 수정 근거를 남기며 핵심 기능을 Mock 성공으로 위장하지 않는다.
- 구현 우선순위는 **가장 작은 동작 가능한 end-to-end 경로 → 안전한 실제 모델 연결 → 스킬/병렬 최적화 → 클라우드/과금**이다.
- 사용자의 핵심 성공 정의는 '스킬 수 증가'가 아니라 **기존 단독 CLI 대비 검증된 시간·실효비용·품질 개선**이다.
- 여러 모델을 연결했다는 사실만으로 성능 우월을 주장하지 말 것.
- 중요한 불확실성은 실제 테스트·공식 문서·계약 확인으로 해결하고, 해결하지 못한 부분은 `MISSING/UNVERIFIED/BLOCKED`로 명시한다.

---

**End of ASO Web Implementation Blueprint v1.0.0 — 2026-11-04**
