---
title: Adaptive Skill Orchestrator — Claude Code · Codex CLI · Gemini CLI 구현 명세서
version: 1.0.0
status: Implementation-ready design specification (not an implemented product)
date: 2026-11-04
language: ko-KR
owners: Project maintainer
---

# Adaptive Skill Orchestrator (ASO)
## 멀티스킬 · 다중 CLI · 저토큰 AI 소프트웨어 개발 에이전트 구현 명세서

> **이 문서의 용도**: 사용자는 이 파일을 Claude Code, Codex CLI, Gemini CLI에 전달하여 시스템을 단계적으로 구현하도록 지시할 수 있다. 이 문서는 *설계·구현 계약*이다. 작성 시점에 실제 프로그램이 구현·설치·벤치마크되었다는 뜻이 아니다.
>
> **첫 번째 구현 지시**: 맨 아래의 **「부록 A. 실행용 에이전트 프롬프트」**를 읽고, [0단계 사전 점검] → [1단계 MVP] → [테스트] 순서로 구현한다. 기존 설치 환경을 먼저 탐지하며, 제3자 플러그인을 중복 설치하거나 설정 파일을 무단 덮어쓰지 않는다.
>
> **성공 조건**: 동일한 과제에서 기본 CLI 에이전트 대비 *품질 저하 없이* 작업 완료 시간과 실제 토큰 비용을 낮출 것. 아래 성능 수치는 목표치이며, 검증된 실적이 아니다.

---

# 0. 제품 정의 및 불변 원칙

## 0.1 문제

스킬을 많이 설치해도 요청마다 모두 실행하면 컨텍스트 오염, 중복 기획, 반복 파일 읽기, 에이전트 간 충돌, 서브에이전트 호출 비용, 복잡한 병렬 통합으로 비용과 시간이 늘어난다. 특히 Superpowers와 Everything Claude Code(ECC)는 작업 프로세스가 일부 중첩된다. 필요한 것은 `Skill Collection`이 아니라 **작업의 성격에 맞는 스킬을 조합해 실행하는 Adaptive Orchestration System**이다.

## 0.2 사용자 목표

사용자가 불완전하거나 모호한 요구사항을 입력하면 아래 순서를 자동으로 수행한다.

```text
사용자 요청
  → ① 의도·제약·가정·검증기준 구체화
  → ② 작업 기획·분해·의존성 분석
  → ③ 보유 스킬 인덱스 검색 → 부족할 때만 find-skills
  → ④ 구현 단계별 최소 스킬 조합 결정
  → ⑤ 가능한 작업만 병렬 실행
  → ⑥ 코드·문서·테스트 구현
  → ⑦ 독립 검증·회귀 테스트·품질 리뷰
  → ⑧ 사용량·실행시간·실패 원인·조합 성과 기록
  → ⑨ 다음 유사 작업에서 검증된 조합 재사용
```

### 필수 목표
1. **속도**: 끝까지 완료되는 경과 시간(wall-clock)을 개선한다.
2. **비용**: 입력·출력·캐시 읽기/쓰기·재작업·하위 에이전트를 모두 포함한 실효 비용을 개선한다.
3. **품질**: 요구사항 충족, 테스트, 보안, 유지보수성 면에서 기본 사용 방식보다 좋아야 한다.
4. **적응성**: 작은 수정은 단일 경량 루트, 복잡한 작업은 계획/전문 스킬/검증을 사용한다.
5. **상호운용성**: Claude Code / Codex CLI / Gemini CLI 각각에서 동작하고 한 프로젝트에서 동일한 의사결정 계약을 사용한다.
6. **신뢰성**: 스킬 설치·업데이트·외부 검색·명령 실행을 임의로 수행하지 않는다. 검증 없는 완료 주장을 하지 않는다.

### 비목표(초기 버전)
- 모든 요청에서 무조건 병렬화
- 세 모델을 매 작업마다 동시 호출하는 앙상블
- ECC의 전체 기능 자동 설치 또는 모든 훅 활성화
- 사용자 확인 없이 임의 외부 스킬 실행
- 고정된 퍼센트의 성능 개선 보장
- 고도화 단계에서 사용자에게 불필요한 질문을 계속하는 것
- 최초 릴리스에 학습 기반 강화학습 라우터 탑재

## 0.3 작업 불변식 (우선순위 순)

```text
P0 안전 / 사용자의 명시 요구 / 데이터 보존
P1 기능의 정확성 / 검증 가능한 결과 / 권한 최소화
P2 품질 및 유지보수성
P3 경과 시간
P4 실효 비용 및 컨텍스트 절감
```

- 비용 최적화 때문에 보안 검증, 필수 테스트, 데이터 보호를 생략하지 않는다.
- 모든 작업에 **단일 최상위 오케스트레이터**만 존재한다. 전문 스킬과 하위 에이전트는 역할 범위 안에서만 행동한다.
- 사용자가 요청한 결과에 필요한 권한만 사용한다. 비밀정보는 에이전트 프롬프트와 실행 로그에 복사하지 않는다.
- 스킬 설명은 *검색을 위한 메타데이터*이고 스킬 본문은 *필요할 때만* 읽는다.
- 자동화는 문제가 없는 경우 원활히 진행해야 하지만, 삭제·외부 전송·운영 배포·유료 결제 등은 명시적 승인 게이트를 거친다.

---

# 1. 도입 대상 스킬과 역할 배분

## 1.1 통합 전략 한눈에 보기

| 구성요소 | 시스템 내 책임 | 로딩/실행 조건 | 중복·위험 차단 |
|---|---|---|---|
| `find-skills` | 로컬 레지스트리로 해결되지 않는 역량 탐색 | 필요한 능력이 없을 때 | 검색 결과는 곧바로 실행하지 않음 |
| `superpowers` | 복잡한 작업의 기획·구현·검증 방식 | STANDARD/DEEP에서 적절한 일부 절차 사용 | 자체 planner를 유일한 관리자처럼 두지 않음 |
| `andrej-karpathy-skills` | 생각 후 코딩, 단순성, 국소 수정, 목표 중심 확인 | 짧은 공통 정책으로 상시 적용 | 원본 전체를 매번 중복 로드하지 않음 |
| `mattpocock/skills` | 요구 분석, 설계의 빈틈 파악, 에이전트용 문서 | 고모호성/고위험 기획만 선별 | `grilling` 질문 강제 방지 |
| `Graphify-Labs/graphify` | 코드베이스 호출/의존성 그래프와 구조 탐색 | 다중 모듈·대규모 리팩터링 | 작은 저장소는 기본 검색 사용; 그래프 최신성 확인 |
| `thedotmack/claude-mem` | 결정·작업 이력 검색, 장기 기억 | 관련 과거 맥락 필요할 때만 검색 | 세션 자동주입 축소; 타 메모리 중복 차단 |
| `DietrichGebert/ponytail` | YAGNI, 최소 구현, 불필요한 코드 방지 | 구현 계획·최종 리뷰의 압축 원칙 | 안전/명시 요구보다 단순성이 우선하지 않음 |
| Prompt caching | 반복 컨텍스트 비용 최적화 | API/CLI가 지원할 때 측정 기반 활용 | 캐싱을 '토큰 절감 스킬'이라고 오해하지 않음 |
| `affaan-m/ECC` | 전문 분야 기술 역량, 특정 리뷰·패턴 | specialist 선택 호출 | ECC 전체 orchestration, memory, hook 무분별 편입 금지 |

> **설치 전 이름 확인**: 사용자의 `ponitail` 표기는 `ponytail`을 의도한 것으로 가정한다. `andrej-karpathy-skills`는 커뮤니티가 Karpathy의 코딩 지침을 스킬화한 프로젝트이며 Andrej Karpathy 본인의 공식 제품이라고 단정하지 않는다. 외부 리포지토리 소유권·버전·라이선스를 잠금 파일에 기록한다.

## 1.2 프로세스 권한 배분

```text
Orchestrator        = WHEN / SHOULD / BUDGET / ACCEPTANCE / STOP
Superpowers         = HOW: 단계별 방법론 중 필요한 것
ECC                = WHAT: 전문 구현·보안·언어별 규칙 중 필요한 것
Matt Pocock         = CLARIFY: 모호함·설계 가정 검토
Karpathy + Ponytail = MINIMALISM: 불필요한 복잡성 억제
Graphify            = STRUCTURE: 코드 관계 탐색
claude-mem          = HISTORY: 이전 작업의 관련 사실 복원
find-skills         = DISCOVERY: 미보유 능력 후보 검색
Caching             = RUNTIME ECONOMICS: 가능한 공통 prefix 캐시
```

### 상충 시 우선순위
1. 현재 사용자의 목표·명시 요구사항
2. 저장소의 보안/아키텍처/테스트 불변조건
3. 오케스트레이터의 결정 및 승인/예산 정책
4. 실행 중인 작업 단계의 계약
5. 선택된 스킬의 전문 지침
6. 다른 제3자 스킬의 일반적 권고

단, 실제 CLI의 시스템/개발자 수준 정책은 프로젝트 문서보다 높은 우선순위를 가질 수 있다. 스킬 내용이 실행 환경의 안전 정책을 우회하게 만들지 않는다.

## 1.3 ECC 편입 결정

**권장: ECC를 전체 오케스트레이터가 아닌 `Capability Library`로 편입.**

### 허용
- 프로젝트 언어·프레임워크에 맞는 전문 스킬만 설치/연동
- 필요할 때 TDD, 보안, 데이터베이스, API 설계, 성능 등 전문 스킬 활성화
- 설치 전에 공식 `consult` 및 미리보기로 변경 파일 확인
- 프로젝트 로컬·버전 고정·후크 미포함을 우선 고려

### 기본 비활성화
- ECC의 별도 master planner/orchestrator가 본 시스템과 경쟁하는 구성
- 중복 메모리 자동주입과 자동요약
- 설정 파일을 가로채는 다중 hooks runtime
- 모든 언어 규칙을 상시 프롬프트에 올리는 구성
- 여러 설치 경로로 동일 ECC를 중복 설치하는 구성

### 설치 관련 중요 사실
ECC는 설치 대상 CLI별로 설치 방식을 **하나만** 선택하도록 안내한다. Claude Code에 플러그인 설치와 전체 수동 설치를 중복 적용하지 않는다. ECC의 버전과 설치 옵션은 변경될 수 있으므로 설치 직전 `--help`와 공식 README 확인 후 실행한다.

공식 저장소: https://github.com/affaan-m/ECC

```bash
# 다음은 공식 저장소의 예시 패턴이며, 실행 전 설치 방법 및 충돌 여부를 조사한다.
git clone https://github.com/affaan-m/ECC.git
cd ECC
node scripts/ecc.js consult "security reviews" --target claude
./install.sh --profile minimal --target claude

# 또는 스킬 선별 설치 예시 (같은 환경에 중복 설치하지 않는다)
./install.sh --target claude --skills security-review
```

> 이 설치 명령을 오케스트레이터가 사용자 승인 없이 실행하면 안 된다. ECC가 이미 플러그인으로 설치되어 있다면 위 설치 명령은 건너뛴다.

---

# 2. 시스템 아키텍처

## 2.1 계층과 데이터 흐름

```mermaid
flowchart TD
    U[User Request] --> INT[Intent Refiner]
    INT --> MODE[Complexity and Risk Classifier]
    MODE --> PLAN[Task Planner and DAG Builder]
    PLAN --> ROUTE[Skill Router + Compatibility Policy]
    REG[(Local Skill Registry)] --> ROUTE
    ROUTE -->|capability missing| FIND[find-skills: Discover Only]
    FIND --> APPROVAL{Review and Approval}
    APPROVAL -->|approved| REG
    ROUTE --> SCHED[Dependency Scheduler]
    SCHED --> WA[Worker A]
    SCHED --> WB[Worker B]
    SCHED --> WC[Worker C]
    WA --> MERGE[Integrate and Verify]
    WB --> MERGE
    WC --> MERGE
    MERGE --> OUT[Artifacts + Evidence]
    OUT --> MET[(Metrics and Skill Outcomes)]
    MEM[(claude-mem Adapter)] --> INT
    G[(Graphify Adapter)] --> PLAN
    CACHE[(Cache and Context Manager)] --> SCHED
    BUDGET[(Budget Controller)] --> SCHED
    MET --> ROUTE
```

**실행 권한 원칙**: DAG 전체에 하나의 컨트롤러만 있고 Worker A/B/C는 분리된 수행자이다. 도식의 3개 워커는 *최대 실행 예시*이지 항상 기동하는 워커 수가 아니다.

## 2.2 모듈 정의

| 모듈 | 입력 | 출력 | 부작용/경계 |
|---|---|---|---|
| `intake` | 사용자 요청, 저장소 메타 | 정규화된 `TaskIntent` | 원본 요청 보존 |
| `refine` | 요청, 과거 의사결정 일부 | 목표·제약·가정·승인 질문 | 질문 최소화 |
| `classify` | 의도, diff 범위, 위험 신호 | `FAST/STANDARD/DEEP`, 리스크 | 결정 근거 기록 |
| `planner` | 성공 기준, 프로젝트 구조 | `Plan` + task DAG | 의존성·파일 소유권 명시 |
| `registry` | 설치된 skill/manifest | 조회 가능한 색인 | 원본 SKILL.md 변경 금지 |
| `router` | 단계, 기술스택, 위험/예산 | `SkillSelection` | 조합 충돌·중복 제거 |
| `discovery` | 부족한 능력 | 검증 대기 후보 | 자동 설치 금지 |
| `scheduler` | task DAG, 자원 제약 | 직렬/병렬 실행 순서 | 제한된 동시성 |
| `runtime` | WorkerTask, 선택 모델 | 실행 결과/usage | CLI 차이를 추상화 |
| `graph` | 저장소, 그래프 상태 | 구조 검색 결과 | 구축 전 비용 검사 |
| `memory` | 질의, 프로젝트 키 | 최소 관련 기록 | 검색만 기본, 정책 기반 저장 |
| `verify` | diff, 성공 기준 | 테스트·리뷰·품질 게이트 결과 | 실패 시 복구 또는 보류 |
| `observability` | 실행 이벤트 | JSONL, 보고서 | 비밀정보 마스킹 |
| `evaluation` | 동일 과제·초기 상태 | A/B/C 비교 | 블라인드 검증 |

## 2.3 작업 수행 방식 두 가지

- **Mode N (Native skill)**: 사용자가 기존 `claude`/`codex`/`gemini` 대화 안에서 `/adaptive-orchestrator` 또는 `$adaptive-orchestrator`를 호출해 이 정책을 적용한다. 빠른 MVP. CLI 고유의 네이티브 에이전트 기능을 사용한다.
- **Mode E (External orchestrator)**: 독립 CLI `aso run "요구사항" --host claude|codex|gemini`가 작업 분류, 스킬 라우팅, DAG, 관측/비용 기록을 외부에서 제어하고 필요할 때 CLI를 자식 프로세스로 호출한다. 재현성과 벤치마크 목적에 적합하다.

**개발 순서**: Mode N으로 행동 규칙과 스킬 메타데이터를 먼저 검증 → Mode E의 실행/관측을 구현. 두 방식을 동시에 처음부터 완성하려 하지 않는다.

---

# 3. 실행 모드: FAST / STANDARD / DEEP

## 3.1 결정 기준

작업마다 아래 특성을 조사한다.

- `scope`: 예상 변경 파일/패키지 수, 기존 코드베이스 의존성
- `ambiguity`: 성공 기준·데이터 계약·산출물 형태의 명료함
- `risk`: 인증, 권한, 결제, 개인정보, 대량 삭제, 인프라, 프로덕션 여부
- `novelty`: 기존 저장소 패턴으로 구현 가능한가
- `independence`: 의미 있는 병렬 단계가 존재하는가
- `testability`: 자동 검증 가능한가
- `budget`: 시간·비용·토큰 한도

### 초기 결정 규칙(휴리스틱, 추후 실험으로 조정)

```text
IF high_security_risk OR destructive_change OR cross_service_migration:
    mode = DEEP
ELSE IF narrow_known_fix AND low_ambiguity AND few_files AND low_risk:
    mode = FAST
ELSE IF multi_package_refactor OR many_dependencies OR unknown_architecture:
    mode = DEEP
ELSE:
    mode = STANDARD
```

| 모드 | 계획 | 스킬 | 워커 | 검증 |
|---|---|---|---|---|
| FAST | 체크리스트 1~5개, 별도 장문 계획 생략 | 공통 최소주의 + 필요 전문 0~1개 | 기본 단일 | 관련 테스트 + diff |
| STANDARD | 작업별 입출력, 경량 DAG | Superpowers 일부 + 스택 관련 1~3개 | 기본 1, 독립 단계 존재 시 2 | 단위·통합 범위 + 변경 영향 점검 |
| DEEP | 상세 DAG, risk register, 설계 계약 | Superpowers 일부 + ECC 전문 선택 + Graphify 조건부 | 보수적 2~3, 파일 충돌 시 격리 | 단위/통합/회귀/보안·별도 리뷰 |

> 수치는 **초기 운영 정책**이지 보편적 최적값이 아니다. 실제 최적화는 A/B/C 벤치마크 결과로 결정한다. 품질이 낮아지면 토큰 예산보다 검증 예산을 우선한다.

## 3.2 질문 고도화 정책

질문을 많이 하는 것이 요구사항 고도화는 아니다. 다음 기준으로 질문한다.

1. 요청 원문에 있는 목표·산출물·기한·범위를 추출한다.
2. 해결에 필요한 빠진 조건들을 식별한다.
3. 누락된 조건을 `blocking`, `high-impact nonblocking`, `minor`로 분류한다.
4. `blocking`: 실행 전에 사용자에게 가능한 한 **한 번에 핵심 질문**을 묻는다. 단, 질문하지 않고 진행하면 위험하거나 사용자 의도와 크게 달라질 때만.
5. `high-impact nonblocking`: 합리적 기본값을 채택하고 가정을 명시한다.
6. `minor`: 묻지 않고 기본값 사용, 보고서에 기록한다.
7. `mattpocock/grilling`는 제품 전략·아키텍처 등 분기 결정이 실제로 중요한 작업에서만 사용한다.

출력 예:

```yaml
objective: "사용자가 종목 알림 조건을 등록하고 알림을 받는 기능 구축"
deliverables: ["API", "web UI", "tests", "README"]
constraints: ["자동 매매 금지", "기존 DB 재사용"]
assumptions:
  - item: "알림 채널은 이메일로 시작"
    impact: medium
    reversible: true
blocking_questions: []
acceptance_criteria:
  - "조건 등록/수정/삭제가 가능하다"
  - "조건 충족 시 중복 알림 방지"
  - "관련 테스트 통과"
```

## 3.3 금지 패턴

- 단일 줄 문구 변경에 Graphify 전체 인덱스 구축 금지
- 형식 검증이나 파일 경로 탐색에 값비싼 모델을 반복 호출 금지
- 모든 작업에서 `grilling` 질문 라운드 강제 금지
- 모든 작업에 리뷰 워커를 띄워 두 번 구현·재작성 금지
- 이미 테스트된 결과를 근거 없이 반복 테스트하거나 전체 저장소를 매 턴 읽지 않기

---

# 4. Skill Registry 및 라우팅

## 4.1 색인 생성

Skill Registry는 다음 입력을 정규화한다.

- `.agents/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, `.gemini/skills/*/SKILL.md`
- 사용자 범위(`~/.agents/skills`, `~/.claude/skills`, `~/.gemini/skills`)
- **설치된 플러그인**의 스킬 메타데이터(사용 가능한 공식 CLI 목록/플러그인 API 또는 확정된 설치 경로에 한함)
- 오케스트레이터 내부 스킬/리뷰 규칙
- `skills.lock.json`의 승인된 버전 정보

금지: 설치 방식과 관계없이 홈 디렉터리 전체를 재귀 탐색해 비밀정보를 유출하거나 모든 스킬 본문을 모델에 전달하는 동작.

### Registry 항목 계약 (TypeScript)

```ts
export type SkillEntry = {
  id: string;                       // 예: ecc:security-review
  name: string;
  source: "builtin" | "project" | "user" | "plugin" | "ecc" | "external";
  uri: string;                      // 로컬 경로 또는 문서 링크
  version?: string;
  contentHash?: string;             // sha256(SKILL.md); 해당 시점의 정확한 버전 확인
  description: string;              // 짧은 문장, 본문 아님
  capabilities: string[];           // e.g. ["security", "typescript", "api-review"]
  phases: Array<"refine" | "plan" | "research" | "build" | "test" | "review">;
  supportedHosts: Array<"claude" | "codex" | "gemini">;
  triggers: string[];
  exclusions: string[];
  conflictsWith: string[];
  prerequisites: string[];
  permissionRisk: "low" | "medium" | "high";
  approved: boolean;
  invocation: "implicit" | "explicit" | "adapter";
  estimatedContextTokens?: number; // 휴리스틱, 검증치와 구분
  enabled: boolean;
};
```

**인덱스 갱신**: 실행 초기 또는 파일/설치 버전이 변했을 때만. `mtime + size + hash`를 사용해 변경 탐지. 인덱스는 자체 캐시 데이터이고 스킬 설치 원본은 변경하지 않는다.

## 4.2 스킬 라우팅 알고리즘

1. `phase`와 필요한 `capabilities`를 정한다.
2. Registry에서 `enabled && approved && supportedHost && phase match` 필터.
3. 의도·기술 스택·단계와 설명/트리거를 기반으로 **로컬 우선** 순위 산정.
4. 의존·충돌 그래프 검사. Superpowers vs ECC 같은 역할 중복 배제.
5. 각 스킬의 비용 대비 기여도 추정. FAST는 0~1, STANDARD/DEEP는 필요 최소 수만 선택.
6. 선택된 스킬 설명은 사용하고, **본문과 관련 참조 파일은 실행 시점에만** 로드한다.
7. 필요한 전문 역량이 없으면 `find-skills` 또는 공식 소스 검색을 수행하여 *설치 후보*만 제시한다.
8. 외부 스킬은 코드·스크립트·네트워크·훅·권한을 검토 후 승인/잠금한다.
9. 작업 결과를 `skill_outcomes`에 기록하여 향후 조합 선택 개선.

### 초기 점수 예시 (교정 전 가중치)

```text
score(skill, task) =
    + 0.35 * capability_match
    + 0.25 * phase_match
    + 0.15 * stack_match
    + 0.15 * past_success_prior
    + 0.10 * deterministic_trigger_match
    - 0.20 * conflict_penalty
    - 0.15 * estimated_context_cost_penalty
```

- 위 숫자는 **시작점**이며 실제로 측정된 최적값이 아니다.
- `past_success_prior`는 충분한 검증 실행 횟수가 없으면 중립값으로 처리한다.
- `permissionRisk=high` 또는 명시 충돌이 있으면 점수와 무관하게 자동 선택 차단.
- 조합의 품질을 개별 스킬 기여도로 곧바로 귀속시키면 안 된다(기저 모델·과제 난이도·상호작용 교란).

## 4.3 `find-skills` 호출 기준

**호출 여부**는 다음 조건의 AND로 결정한다.

```text
needs_new_capability
AND no_sufficient_local_skill
AND not_a_trivial_builtin_task
AND discovery_budget_available
```

발견 → 정보/라이선스 확인 → 신뢰성 평가 → 설치 승인 → 등록 → 필요 시 작업 수행 순서. 새로운 스킬이 있더라도 현재 작업의 시간·품질상 이익이 불분명하면 기존 도구를 쓴다.

## 4.4 원본 스킬 설치와 라우팅의 분리

이 제품은 기존 설치 도구(`npx skills`, Claude 플러그인 명령, ECC installer 등)를 무조건 대체하지 않는다. **'설치·업데이트'는 사용자가 승인하는 관리 절차**, **'선택·호출'은 자동화 가능한 실행 절차**로 분리한다.

---

# 5. Task DAG, 병렬화 및 구현 워커

## 5.1 DAG 계약

```ts
export type ExecutionTask = {
  id: string;
  title: string;
  phase: "research" | "design" | "build" | "test" | "review" | "integration";
  dependsOn: string[];
  inputFiles: string[];
  expectedOutputFiles: string[];
  writeScope: string[];              // 예상 수정 파일/디렉터리
  acceptanceCriteria: string[];
  skills: string[];
  assignedHost?: "claude" | "codex" | "gemini";
  workerRole?: string;
  estimatedEffort: "small" | "medium" | "large";
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
};

export type WorkPlan = {
  planVersion: 1;
  requestId: string;
  mode: "FAST" | "STANDARD" | "DEEP";
  objective: string;
  assumptions: string[];
  successCriteria: string[];
  tasks: ExecutionTask[];
  criticalPath: string[];
  verificationCommands: string[];
};
```

## 5.2 병렬화 조건

작업 A와 B는 아래가 모두 참일 때만 동시에 실행한다.

```text
A dependsOn B == false AND B dependsOn A == false
AND neither task has unfinished prerequisites
AND writeScope(A) ∩ writeScope(B) == empty  (또는 격리 worktree)
AND shared API contracts are agreed
AND concurrency capacity exists
AND estimated_wall_time_benefit > worker_overhead_and_merge_risk
```

### 예시: API + 프론트엔드 개발

```mermaid
flowchart TD
 A[요구사항 고도화] --> B[API/DTO/DB 계약 확정]
 B --> C[백엔드 구현]
 B --> D[프론트엔드 구현]
 B --> E[테스트 케이스 준비]
 C --> F[통합]
 D --> F
 E --> F
 F --> G[최종 검증]
```

- B를 먼저 끝내야 C/D/E가 독립적으로 실행될 수 있다.
- E는 구현 의존 테스트가 아니라 계약 테스트 준비일 때 병렬 가능하다.
- 개발자/에이전트가 다른 파일을 변경하도록 분배한다.

## 5.3 워커 입력과 출력

워커는 전체 대화와 모든 스킬을 전달받지 않는다. 반드시 아래 최소 구조로 전달한다.

```json
{
  "request_id": "req-0001",
  "task_id": "backend-api",
  "objective": "알림 조건 CRUD API 구현",
  "context": {
    "repo_root": ".",
    "relevant_paths": ["src/server", "src/contracts"],
    "interface_contract": "docs/contracts/alerts.openapi.yaml",
    "known_decisions": ["기존 인증 middleware 재사용"]
  },
  "allowed_write_paths": ["src/server/alerts", "tests/alerts"],
  "selected_skills": ["ecc:api-design"],
  "acceptance_criteria": ["CRUD 테스트 통과", "기존 API 회귀 없음"],
  "stop_conditions": ["권한 범위를 벗어나는 변경 필요", "계약과 실제 구조 충돌"]
}
```

워커 응답:

```json
{
  "task_id": "backend-api",
  "status": "success",
  "changed_files": ["src/server/alerts/routes.ts", "tests/alerts/routes.test.ts"],
  "tests_run": [{"command": "pnpm test -- alerts", "result": "pass"}],
  "assumptions": [],
  "blockers": [],
  "handoff": "API 인터페이스 계약을 준수함",
  "usage": {"input_tokens": null, "output_tokens": null, "source": "not_reported"}
}
```

`null`은 실측 불가를 의미한다. 모델에게 토큰을 짐작해서 숫자로 채우게 하지 않는다.

## 5.4 파일 격리 및 병합

- 기본: 서로 다른 디렉터리에서 안전하게 작업할 수 있는 경우 병렬 실행.
- 중복 파일을 수정해야 한다면 순차 실행하거나 Git worktree/branch로 격리.
- worktree 사용 시 작업별 브랜치, 테스트, 커밋/패치 추적. 작업 완료 후 통합 에이전트가 변경을 검토하고 필요한 순서로 반영.
- 병합 실패·계약 충돌은 무한 자동 재시도하지 않는다. 원인 요약, 복구 시도 횟수 제한, 사용자 승인 경계.
- 통합 완료 전에는 최종 성공으로 보고하지 않는다.

## 5.5 정지/재계획 조건

- 목표 달성 및 테스트 통과 → 즉시 완료
- 예상하지 못한 파괴적 변경 필요 → 승인 필요
- 동일한 실패 2회 이상 → 맥락 재수집/계획 수정, 맹목적 반복 중지
- 예산 경고(예: 사용량 80%) → 새 전문 스킬/불필요한 병렬 실행을 중단하고 필수 검증에 예산 배분
- 예산 한도 초과 → 안전하게 현재 파일 상태 저장 후 미완료 항목과 원인 보고

---

# 6. Context Manager, Graphify, claude-mem, 캐싱

## 6.1 Context 최소화

워크 컨텍스트를 네 계층으로 구분한다.

```text
Tier 0: 공통 정책(짧게) — 항상
Tier 1: 요청/수용 기준/관련 경로 — 요청별
Tier 2: 선택된 스킬 본문/관련 코드 — 단계별 지연 로딩
Tier 3: 긴 문서, 이전 실행 원문, 전체 그래프 — 조회가 필요한 경우에만
```

**컨텍스트 규칙**:
- 같은 파일을 여러 워커에게 보낼 경우 파일 전체보다 계약/경로/관련 코드 조각을 우선한다.
- 사용자 요청의 원문과 수용 기준은 요약으로 변형하지 않고 식별 가능하게 유지한다.
- 단계 종료 시 `Decision / Evidence / Files / Open issues / Next step` 형태로 handoff 저장.
- 요약이 사실을 왜곡하지 않도록 원본 파일 경로 및 테스트 출력을 참조로 연결한다.

## 6.2 Graphify 사용 기준

Graphify는 로컬 코드 AST 중심의 그래프 구축·질의를 지원한다. 복잡한 호출 관계 분석이나 레거시 코드 변경에 도움이 되지만 초기 그래프 구축과 이후 유지에도 비용이 존재한다.

**활성화 신호**:
- 다중 패키지/언어 구조를 이해해야 함
- 의존성 역추적, 영향도 분석, 순환 의존성 검토
- 대규모 리팩터링/복잡한 코드베이스의 구조적 질문

**비활성화 신호**:
- 범위가 정해진 작은 함수 수정
- 저장소 내 필요한 파일이 이미 명확함
- 그래프가 오래되어 신뢰할 수 없고 갱신 비용이 작업보다 큼

Graphify 공식 리포지토리: https://github.com/Graphify-Labs/graphify

```bash
# 설치 후보 예시. 실제 설치는 사용자의 동의 후 수행.
uv tool install graphifyy   # 공식 PyPI 배포명은 graphifyy(이중 y)
graphify install --project
# 이후 graphify --help로 현재 지원 명령을 확인한다.
```

- Graphify 설치로 자체 훅/항상 로드되는 설정이 추가될 수 있으므로 파일 변경을 미리 검사한다.
- 코드는 로컬 파서로 처리할 수 있지만 문서·미디어 의미 처리에 LLM 백엔드가 쓰일 수 있다. 데이터 보호 요구가 있다면 `--code-only`, 백엔드 비활성화, 허용된 제공자 정책을 검토한다.
- 인덱스 생성 버전과 Git HEAD(또는 소스 해시)를 기록해 갱신 여부 판단. 오래된 그래프가 코드보다 높은 신뢰도를 가지면 안 된다.

## 6.3 claude-mem 사용 기준

claude-mem은 이전 세션의 도구 사용·결정·요약을 저장하고 검색하는 별도 시스템이다. 임의의 기억이 현재 코드 상태보다 신뢰도가 높다고 가정하지 않는다.

**검색 우선순위**:
1. 현재 사용자 메시지
2. 현재 저장소 파일·코드·테스트
3. 프로젝트 내 ADR/결정 문서
4. 관련 claude-mem 검색 결과(근거와 시점 확인)

**검색 시점**: `사용자가 이전 결정을 언급`, `이전 작업 재개`, `장기 아키텍처 제약 재사용`, `같은 실패 반복`.

**프로토콜**: compact search → 후보 ID 식별 → 관련 항목만 상세 로딩. 자동 SessionStart 주입은 짧게 제한한다. 개인 정보/비밀정보는 기록·재주입 방지 설정을 검토한다.

공식 저장소: https://github.com/thedotmack/claude-mem

## 6.4 Prompt caching: 무엇이 절감되는가

Prompt caching은 **런타임/API 기능**이며 스킬의 본문 자체를 절감시키는 마법이 아니다.

- 안정된 시스템/정책 prefix를 재사용하고, 자주 변하는 사용자 요청을 뒤로 둔다.
- 캐시 히트가 높은 구성을 실측으로 선택한다.
- 사용량 보고를 `uncached_input`, `cache_creation`, `cache_read`, `output`으로 구분한다.
- CLI 자체의 내부 캐싱은 외부 오케스트레이터가 임의로 통제할 수 없을 수 있다.
- API 직접 호출을 사용할 때만 해당 제공자의 `cache_control`/TTL 사양을 확인하고 구현한다.
- 프롬프트 전부가 매번 바뀌는 경우 캐시 쓰기만 발생해 오히려 비용이 늘 수 있다.

실효 비용 계산(가격표에 따라 다름):

```text
billed_cost_usd =
    (uncached_input_tokens / 1e6) * price_input_per_million
  + (cache_creation_tokens / 1e6) * price_cache_write_per_million
  + (cache_read_tokens / 1e6) * price_cache_read_per_million
  + (output_tokens / 1e6) * price_output_per_million
  + known_tool_or_service_fees
```

- **Provider가 필드 미제공**이면 측정 불가로 기록한다. 제공된 전체 입력 토큰과 캐시 토큰 간 중복 집계를 주의한다.
- 가격표는 `pricing-snapshot.json`에 모델별·유효일별로 저장한다.
- 정액 구독 CLI 사용량을 API 단가로 환산한 값은 실제 청구액이 아닌 **비교용 환산 비용**으로 별도 표시한다.
- 재시도, 병렬 워커, 검증, 실패한 호출까지 총비용에 포함한다.

---

# 7. 각 CLI 호환성과 실행 인터페이스

## 7.1 호환성 기본 원칙

`SKILL.md`는 세 CLI에서 활용할 수 있지만, 각 CLI의 **검색 위치, 자동 활성화 방식, 승인 UI, 확장 필드, 훅**은 동일하지 않다. 따라서 공통 정본(canonical spec)과 CLI별 얇은 entrypoint를 둔다.

| 항목 | Claude Code | Codex CLI | Gemini CLI |
|---|---|---|---|
| 프로젝트 공통 지침 | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` |
| 스킬 폴더(예) | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` 또는 `.gemini/skills/` |
| 스킬 형식 | `SKILL.md` | `SKILL.md` | `SKILL.md` |
| 지연 로딩 | 지원 | 지원 | 지원, 활성화/동의 흐름 존재 |
| 호스트 고유 필드 | 일부 frontmatter 옵션 | 일부 metadata 옵션 | 공식 Gemini 방식 준수 |
| 비대화식 사용 예 | `claude -p` | `codex exec` | `gemini -p` |

참고 문서: [Claude Skills](https://code.claude.com/docs/en/skills), [Codex Skills](https://developers.openai.com/codex/skills), [Gemini CLI Skills](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md)

### 중복 방지
- 공통 `.agents/skills/adaptive-orchestrator/SKILL.md`를 정본으로 두고, Claude용 복사/동기화 작업을 **배포 스크립트**로 생성한다.
- 같은 CLI에서 동일한 스킬이 두 경로에 중복 등록되지 않도록 `aso doctor`가 확인한다.
- 심볼릭 링크/복사 동작은 OS와 CLI 버전에 따라 다를 수 있으므로 첫 버전에는 명시적 복사 + SHA-256 동기화 검증 권장.
- 기본 호스트 지침 파일에는 상세 매뉴얼을 복사하지 말고 파일 경로/호출 규칙만 남긴다.

## 7.2 호스트별 얇은 지침 파일

**`CLAUDE.md` (제안 내용)**

```md
# Project agent guidance
- For development requests, follow `docs/ASO_SPEC.md` and the adaptive-orchestrator skill.
- Only one top-level orchestration authority is allowed.
- Use local registry before external skill discovery.
- Apply FAST/STANDARD/DEEP according to risk and scope.
- Do not duplicate ECC or claude-mem hooks or install methods.
- Never claim successful tests unless they were executed.
```

**`AGENTS.md` (제안 내용)**

```md
# Project agent guidance
- Read `docs/ASO_SPEC.md` when implementing or maintaining this orchestrator.
- Follow `.agents/skills/adaptive-orchestrator/SKILL.md` for orchestration workflows.
- Use one top-level planner. Route only minimal skills and verify real changes.
- Report actual token usage only when available; otherwise set `null`.
```

**`GEMINI.md` (제안 내용)**

```md
# Project agent guidance
- Read `docs/ASO_SPEC.md` for system design and completion criteria.
- Use `.agents/skills/adaptive-orchestrator/SKILL.md` when relevant.
- Do not add duplicate hooks or load every external skill at startup.
- Prefer narrow, safe tool calls and verifiable test results.
```

이 예시의 `docs/ASO_SPEC.md`는 저장소에 배치할 **현재 문서의 권장 위치**이다. 실제 프로젝트에서 다른 위치를 사용하면 지침 경로도 일치시켜야 한다.

## 7.3 비대화식 런타임 어댑터

초기 구현은 CLI 바이너리 버전을 확인하고 그 버전의 공식 출력 형식을 사용한다. 아래는 **명령 형식 예시**이며 무인 승인 옵션을 임의로 붙이지 않는다.

```bash
# Claude Code (현재 설치 버전에서 옵션 확인)
claude -p "요구사항을 분석하고 JSON으로 반환" --output-format json

# Codex CLI: 출력을 JSONL 이벤트로 수집
codex exec --json "요구사항을 분석하고 JSON으로 반환"

# Gemini CLI: JSON 응답 래퍼로 반환
gemini -p "요구사항을 분석하고 JSON으로 반환" --output-format json
```

- **프로그램에 들어갈 실제 명령 조합은 `--help` 확인과 통합 테스트를 거쳐 고정**한다.
- 쉘 문자열을 합성하지 않는다. `child_process.spawn(command, args, {shell:false, cwd, ...})`를 사용한다.
- 프롬프트 길이가 큰 경우 안전한 임시 파일/표준입력(지원되는 CLI에서만)으로 넘긴다.
- stdout/stderr 파서는 호스트별 구분한다. JSON/JSONL 스키마를 동일하다고 가정하면 안 된다.
- 인증/권한/요금제/모델 이용 가능 여부를 먼저 검사한다.
- CI에서는 모델/CLI 버전과 실행 권한 정책을 고정한다.
- 사용자 승인 없이 `--yolo`, `--dangerously-skip-permissions` 등 고위험 자동승인 모드를 붙이지 않는다.

### 런타임 인터페이스

```ts
export interface AgentRuntime {
  id: "claude" | "codex" | "gemini";
  detect(): Promise<{ installed: boolean; version?: string; authenticated?: boolean }>;
  run(task: WorkerTask, options: RuntimeOptions): Promise<WorkerResult>;
  supports(feature: "json_usage" | "streaming" | "isolated_worktree" | "native_skills"): boolean;
}

export type RuntimeOptions = {
  cwd: string;
  timeoutMs: number;
  model?: string;
  allowedWritePaths: string[];
  envAllowlist: string[];
  approvalPolicy: "manual" | "safe-default";
};
```

- `detect()`의 인증 필드는 관찰 불가능하면 `undefined`; 인증 성공을 추정하지 않는다.
- 일부 CLI가 파일 경로별 쓰기 제한을 직접 보장하지 않으면 **격리 실행 환경**을 쓰거나 경고 후 미지원으로 분류한다. 프롬프트만으로 OS 파일 접근이 차단된다고 주장하지 않는다.
- `run()`의 시간 초과 시 자식 프로세스 트리를 안전히 종료하고 결과를 보존한다.

---

# 8. 권장 저장소 구조 및 구현 기술

## 8.1 기술 선택

- Node.js LTS + TypeScript (세 CLI 실행/프로세스 관리, JSON 파싱, 크로스플랫폼 지원에 적합)
- Package manager: `pnpm` (선택; 팀 환경이 npm이면 교체 가능)
- `zod`: 런타임 입력/출력 스키마 검증
- `commander` 또는 동등한 검증된 CLI parser
- `vitest`: 단위/통합 테스트
- `execa` 또는 Node `spawn`: 자식 프로세스 제어
- `better-sqlite3` 또는 초기 JSONL: 실행 측정 저장소 (초기는 JSONL 권장)
- Graphify와 claude-mem은 선택적 외부 통합. 이들의 DB를 직접 수정하지 않는다.

## 8.2 프로젝트 구조

```text
adaptive-skill-orchestrator/
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .env.example
├── CLAUDE.md
├── AGENTS.md
├── GEMINI.md
├── docs/
│   ├── ASO_SPEC.md                 # 이 문서
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── INSTALLATION.md
│   └── BENCHMARK.md
├── config/
│   ├── aso.config.json
│   ├── skills.lock.json
│   ├── pricing-snapshot.json
│   └── policies/
│       ├── conflict-rules.json
│       └── risk-rules.json
├── .agents/skills/
│   └── adaptive-orchestrator/
│       ├── SKILL.md                 # 공통 정본
│       └── references/
│           ├── fast.md
│           ├── standard.md
│           └── deep.md
├── .claude/skills/
│   └── adaptive-orchestrator/
│       └── SKILL.md                 # 정본에서 생성/동기화
├── src/
│   ├── cli.ts
│   ├── core/
│   │   ├── types.ts
│   │   ├── intake.ts
│   │   ├── refiner.ts
│   │   ├── classifier.ts
│   │   ├── planner.ts
│   │   ├── dag.ts
│   │   ├── router.ts
│   │   ├── scheduler.ts
│   │   ├── budget.ts
│   │   └── verifier.ts
│   ├── registry/
│   │   ├── discover-local.ts
│   │   ├── parse-skill.ts
│   │   ├── index.ts
│   │   ├── trust.ts
│   │   └── conflicts.ts
│   ├── adapters/
│   │   ├── runtime.ts
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   ├── gemini.ts
│   │   ├── graphify.ts
│   │   ├── claude-mem.ts
│   │   └── discovery.ts
│   ├── context/
│   │   ├── packer.ts
│   │   ├── summary.ts
│   │   └── cache-policy.ts
│   ├── observability/
│   │   ├── events.ts
│   │   ├── telemetry.ts
│   │   ├── pricing.ts
│   │   └── report.ts
│   └── security/
│       ├── redaction.ts
│       ├── approvals.ts
│       └── sandbox.ts
├── scripts/
│   ├── sync-skills.ts
│   ├── inspect-installs.ts
│   └── benchmark.ts
├── tests/
│   ├── unit/
│   │   ├── classifier.test.ts
│   │   ├── router.test.ts
│   │   ├── dag.test.ts
│   │   ├── conflicts.test.ts
│   │   └── budget.test.ts
│   ├── integration/
│   │   ├── mock-runtime.test.ts
│   │   ├── cli-adapters.test.ts
│   │   └── pipeline.test.ts
│   ├── fixtures/
│   │   ├── skill-registries/
│   │   ├── toy-repo/
│   │   └── tasks.json
│   └── evals/
│       ├── cases.jsonl
│       └── graders/
└── .aso/                           # 실행 중 생성; 기본 gitignore
    ├── registry-cache.json
    ├── runs/
    ├── logs/
    └── checkpoints/
```

**중요**: `.aso/`에는 작업 명령, 로그, 토큰 기록이 쌓일 수 있으므로 기본 비공개·gitignore·민감정보 마스킹. 테스트 픽스처 외 비밀정보를 커밋하지 않는다.

---

# 9. 설정 파일 계약

## 9.1 `config/aso.config.json` 예시

```json
{
  "version": 1,
  "defaultHost": "claude",
  "defaultMode": "auto",
  "execution": {
    "maxConcurrency": 3,
    "defaultTimeoutMs": 600000,
    "enableParallel": true,
    "useWorktreesOnWriteConflict": true,
    "requireApprovalForExternalInstall": true,
    "requireApprovalForDestructiveAction": true,
    "retryLimitPerTask": 2
  },
  "routing": {
    "localFirst": true,
    "allowExternalDiscovery": true,
    "autoInstallSkills": false,
    "eccMode": "specialist-only",
    "allowMultiplePlanners": false,
    "memoryProvider": "claude-mem",
    "graphify": "conditional"
  },
  "context": {
    "progressiveDisclosure": true,
    "maxSkillBodiesPerTask": 3,
    "maxMemoryResults": 5,
    "alwaysLoadedPolicyTargetTokens": 700,
    "redactSecrets": true
  },
  "budget": {
    "maxEstimatedUsdPerRun": null,
    "maxObservedTokensPerRun": null,
    "warnAtFraction": 0.8,
    "reserveVerificationFraction": 0.2,
    "onUnknownUsage": "track-as-unknown"
  },
  "telemetry": {
    "enabled": true,
    "logPrompts": false,
    "logCommandOutput": false,
    "storeUsageWhenReported": true
  }
}
```

이 숫자는 첫 버전의 **기본 정책 제안**이다. `maxEstimatedUsdPerRun=null`은 비용 무제한 집행 허가가 아니라 *금액 기반 자동 차단을 사용하지 않음*을 뜻한다. 고비용 호출·외부 실행은 별도의 승인을 준수한다.

## 9.2 `skills.lock.json` 형식

```json
{
  "version": 1,
  "entries": [
    {
      "id": "ecc:security-review",
      "repository": "https://github.com/affaan-m/ECC",
      "commit": "FILL_AFTER_APPROVAL",
      "sourcePath": "skills/security-review/SKILL.md",
      "sha256": "FILL_AFTER_APPROVAL",
      "installationMode": "selected-manual-or-native-plugin",
      "approvedByUser": false
    }
  ]
}
```

- `FILL_AFTER_APPROVAL`은 실제 설치 전 플레이스홀더. 이 상태면 실행 불가.
- 로컬 스킬의 출처·버전·체크섬·승인 내역을 남긴다.
- 라이선스 확인 없이 코드나 스킬을 재배포하지 않는다.

## 9.3 스킬 충돌 정책 예시

```json
{
  "exclusiveRoles": {
    "topLevelPlanner": ["aso:planner", "ecc:planner", "superpowers:planner"],
    "persistentMemory": ["claude-mem", "ecc:memory"]
  },
  "preferredRoles": {
    "topLevelPlanner": "aso:planner",
    "persistentMemory": "claude-mem"
  },
  "conditionalSpecialists": ["ecc:*", "graphify:*"],
  "prohibitedDefaultBehaviors": [
    "auto-install-external-skills",
    "load-all-skill-bodies",
    "duplicate-hook-registration",
    "unbounded-parallel-workers"
  ]
}
```

- 이 파일은 자체 프로그램용 **설계 데이터**이며 ECC/Superpowers의 내장 설정 문법으로 오해하면 안 된다.
- 일부 skill 이름은 예시 ID다. 실제 설치 명칭이 다르면 Registry가 이를 정상화한다.

---

# 10. CLI 명령·사용자 경험 명세

## 10.1 필수 명령 (최초 구현)

```bash
aso doctor
aso skills list
aso skills inspect <skill-id>
aso plan "로그인 API에 비밀번호 재설정 추가" --host claude
aso run "로그인 API에 비밀번호 재설정 추가" --host claude
aso report <run-id>
aso benchmark --suite tests/evals/cases.jsonl
```

선택 확장:

```bash
aso config validate
aso skills sync
aso skills discover "typescript security" --dry-run
aso run "요구사항" --host codex --mode standard
aso run "요구사항" --host gemini --mode fast
aso benchmark --compare baseline,all-skills,adaptive
```

### 명령 동작

- `doctor`: CLI 발견 여부, 버전, 중복 스킬, 훅 충돌 가능성, 호스트 호환성, 필수 폴더·권한·설정 경로, `SKILL.md` 정본 해시를 확인. 확인 못한 항목은 `UNKNOWN`.
- `skills list`: 이름/출처/트리거/위험/승인상태와 실제 설치 여부 표시.
- `skills inspect`: 본문 경로·체크섬·동작 권한·충돌 요소 표시(출력은 선택적으로만).
- `plan`: **코드 변경 없이** 정규화 요구사항, 모드, DAG, 예상 스킬 조합, 검증 방법을 출력. 단, 프로젝트 분석에 필요하지 않은 외부 네트워크 호출은 하지 않는다.
- `run`: 계획을 실행하며 진행 사건을 JSONL로 기록. 실제 도구 권한의 정책은 호스트와 OS sandbox가 적용.
- `report`: 성공 기준별 근거, 변경 파일, 테스트, 시간, 토큰·청구비용(존재 시), 미완료·불확실성을 출력.
- `benchmark`: 동일 과제·환경으로 대조군 실행 및 통계 산출. 프로덕션 폴더에 직접 변경하지 않는다.

## 10.2 정상 실행 출력 예

```text
Request: req-0001
Mode: STANDARD (reason: new API + UI, medium integration risk)
Skills selected: karpathy-guidelines, superpowers:implementation, ecc:api-design
External skill discovery: skipped (local capabilities sufficient)
Plan: 4 tasks, dependency depth 3, 2 tasks parallelizable
Approval required: no destructive actions planned
Completed: 4/4
Verification: 26/26 relevant tests passed
Elapsed: measured 00:04:42
Token usage: not reported by current host
Outcome: completed; changed files listed in .aso/runs/<id>/report.json
```

예시 숫자는 결과 양식 설명을 위한 더미 데이터이며 실제 실험 기록이 아니다.

---

# 11. 알고리즘 계약 및 구현 의사코드

## 11.1 Orchestrator 파이프라인

```ts
async function executeRequest(rawRequest: string, host: Host) {
  const run = createRun({ rawRequest, host, startTime: now() });
  const environment = await inspectEnvironment();
  const intent = await refineRequest(rawRequest, environment);
  const decision = classifyMode(intent, environment);
  const plan = await buildAndValidateDAG(intent, decision, environment);

  const registry = await loadOrBuildRegistry(environment);
  for (const task of plan.tasks) {
    const selection = routeSkills(task, registry, decision);
    if (selection.capabilityMissing) {
      const candidates = await discoverExternalCandidates(task); // discover only
      await recordUnapprovedCandidates(candidates);
      // approval 없으면 내장 역량으로 진행하거나 사용자에게 보류 사유 보고
    }
    task.skills = selection.approvedMinimalSkills;
  }

  await enforceApprovals(plan);
  const output = await scheduleAndRun(plan, {
    host,
    maxConcurrency: config.execution.maxConcurrency,
    budget: createBudgetMonitor(config),
    isolation: "worktree-when-needed"
  });

  const evidence = await verifyDeliverables(output, intent.acceptanceCriteria);
  const report = summarizeWithMeasuredUsage(run, output, evidence);
  await recordRun(report); // redacted telemetry
  return report;
}
```

이 코드는 **의사코드**다. 위에서 언급한 타입 및 함수는 아직 구현되지 않았다. 특정 외부 스킬의 기능을 실제 API처럼 직접 호출한다는 의미도 아니다.

## 11.2 DAG 유효성 검사

- 모든 `id`는 유일해야 한다.
- `dependsOn`은 존재하는 작업만 참조해야 한다.
- 자기 자신을 의존하면 안 된다.
- 사이클이 있으면 계획 실패(`INVALID_DAG`).
- 병렬 실행 시 파일 소유권 또는 worktree 격리 확인.
- high-risk task는 승인 상태 확인.

## 11.3 스케줄링 알고리즘

```text
pending := all tasks
running := empty
completed := empty
failed := empty

while pending or running:
  ready := pending tasks whose dependencies are in completed
  for task in ready sorted by critical-path priority:
    if free_slot and approval_ok and budget_ok and write_scope_safe:
      launch(task)
      move pending -> running
  wait for at least one running task to finish
  on success: move running -> completed
  on recoverable failure: retry <= limit, otherwise mark failed
  on failure blocking descendants: mark descendants blocked
  if no runnable task and no running task: fail with deadlock diagnostic

merge/check worktrees, run verification, report outcomes
```

- critical path 우선순위는 실제 작업 시간 예측 오차를 고려해 보수적으로 사용.
- concurrent worker가 많을수록 비용이 선형적으로 줄지 않는다.
- 서브에이전트를 **분석만** 시킬지 **직접 쓰기**까지 허용할지 분리한다.

## 11.4 BudgetController

```ts
type Usage = {
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
  reportedCacheWriteTokens?: number;
  reportedCacheReadTokens?: number;
  actualBilledUsd?: number;
  estimatedUsd?: number;
  source: "provider" | "cli" | "pricing_estimate" | "unknown";
};
```

**예산 측정 규칙**:
- 정확한 사용량은 Provider/CLI에서 구조화해 제공하는 필드에서 읽는다.
- 캐시 관련 필드는 provider 스키마별 정의에 따라 중복 없는 형태로 정규화한다.
- 측정이 어려우면 `null/unknown` 기록, 추측값으로 성공 KPI를 계산하지 않는다.
- `actualBilledUsd`, `estimatedUsd`는 다른 데이터다. 실제 청구액 미제공 시 0이라고 쓰지 않는다.
- 프로그램은 가능한 경우 타임아웃·워커 수·최대 재시도를 강제하고, 토큰 상한을 직접 강제할 수 없는 CLI는 미지원 사실을 보고한다.

---

# 12. 테스트 계획과 수용 기준

## 12.1 단위 테스트 목록

| 테스트 | 입력 | 기대 결과 |
|---|---|---|
| FAST 분류 | 1개 파일 주석 수정 | FAST, 워커 1, Graphify 미호출 |
| DEEP 위험 상승 | 인증 우회 수정 요청 | DEEP, 보안 검증, 승인 정책 |
| 불확실성 제어 | 모호한 UI 요구 | 중요한 가정만 기록, 무한 질문 금지 |
| Registry 충돌 | ECC planner + ASO planner | ASO 1개만 authoritative |
| 중복 스킬 | 같은 이름 2개 경로 | doctor 경고 및 중복 비활성 정책 |
| 외부 스킬 발견 | 필요한 capability 없음 | 후보로만 등록, 자동 설치 없음 |
| 스킬 비용 | 2개가 동일 역량 | 비용 낮고 신뢰도 높은 최소 선택 |
| DAG 검증 | 순환 참조 | 실패 + 사이클 설명 |
| 파일 충돌 | 두 task가 같은 파일 수정 | 직렬화 또는 격리 |
| 독립 작업 | 파일/의존 분리 | concurrency 제한 내 병렬 |
| 재시도 | 동일 작업 반복 실패 | 설정 횟수 후 중단/보고 |
| 캐시 통계 | cache_read 미제공 | unknown, 비용 0으로 기록 금지 |
| 비밀정보 | API 키가 로그에 포함 | 로그에서 마스킹 |
| 테스트 실패 | 수정 코드 테스트 실패 | 최종 상태 FAIL 또는 PARTIAL |
| 모델 CLI 미설치 | `codex` 없음 | doctor 진단 및 안전한 실패 |

## 12.2 통합 테스트

1. 임시 Git 저장소를 만들고 사전 상태를 커밋한다.
2. `aso plan`의 비변경 실행을 확인한다.
3. `MockRuntime`으로 전체 워크플로를 실행한다(외부 유료 모델 호출 없음).
4. 실제 CLI별 smoke test는 옵트인 환경에서 시행한다.
5. 작업별 수용 기준, 파일 변경 범위, 테스트 기록, 토큰 계측 여부를 확인한다.
6. Windows/macOS/Linux 경로와 프로세스 종료 동작을 별도로 테스트한다.
7. 설치·업데이트·제거 시 원본 CLAUDE.md/AGENTS.md/GEMINI.md 및 훅 구성을 백업하고 무손상 검증.

## 12.3 품질 게이트

모든 실행에서:
- 요구사항의 모든 수용 기준은 `pass / fail / blocked / unverified` 중 하나여야 함.
- `pass`에는 테스트 이름/명령 또는 확인 가능한 증거가 있어야 함.
- 테스트 미실행은 `pass`가 아니라 `unverified`.
- 빌드/테스트 실패가 남으면 성공 보고 금지.
- 고위험 보안 작업은 관련 추가 검사/정적 분석/권한 리뷰를 거친다.
- 관련 없는 파일 수정 발견 시 이유와 승인 필요 여부를 기록.

---

# 13. A/B/C 벤치마크 설계

## 13.1 비교 대상

- **A — Baseline**: 동일 CLI/동일 모델, 기본 기능만 사용. ASO 및 비교 대상 커뮤니티 스킬 비활성화.
- **B — All-Skills**: 가능한 범위에서 사용자가 제안한 주요 스킬과 ECC를 광범위하게 활성화(안전 정책은 동일 적용).
- **C — Adaptive (본 제품)**: ASO의 선택적/지연 로딩, 조건부 ECC, DAG·병렬·예산·메모리 정책 사용.

> 세 모델(Claude/Codex/Gemini)을 모두 동일한 점수로 섞지 않는다. **같은 호스트·같은 모델·같은 인증/권한 정책** 내 A/B/C를 우선 비교한다. 호스트별 차이는 별도의 층화 결과로 보고한다.

## 13.2 실험 통제

1. 같은 Git commit·같은 파일/환경에서 시작. 실행마다 임시 clone 또는 worktree 사용.
2. 동일한 원문 프롬프트, 성공 기준, 모델 버전, 실행 제한을 적용.
3. 실행 순서를 무작위화해 시간대/서비스 부하 영향을 분산.
4. 캐시 **cold**와 **warm**을 구분해 별도 비교.
5. 과제 수준: FAST 10개 이상, STANDARD 10개 이상, DEEP 10개 이상으로 시작하되 최종 결과 신뢰구간 보고.
6. 각 과제/조건은 가능한 한 여러 번 반복해 중앙값과 분산을 측정.
7. 품질은 테스트·숨겨진 acceptance checks·블라인드 코드리뷰(필요 시)를 사용.
8. 실험에서 사용된 스킬 버전·호스트 버전·가격표 날짜·인증 환경을 기록.
9. 실패·중도 종료·모델 도구 오류도 표본에서 제거하지 않는다.
10. 동일한 작업으로 스킬 라우터를 튜닝하고 그 결과를 같은 작업의 평가에 재사용하지 않는다(훈련/검증/홀드아웃 분리).

## 13.3 측정 지표

```text
Wall-clock latency  = 시작 ~ 요구사항을 만족한 최종 결과까지 경과 시간
Token usage         = 모든 워커 + 메인 + 재시도 + 검증에 사용된 실측 토큰
Billed cost         = 확인 가능한 실제 청구 금액 또는 별도 표시한 추정 환산 비용
Pass rate           = 모든 필수 acceptance tests를 충족한 실행 비율
Regression rate     = 기존 동작/테스트를 깨뜨린 실행 비율
Security defects    = 보안 게이트에서 확인된 심각한 결함 수
Rework rate         = 실패한 재시도/수정 단계 및 변경량
Unnecessary diff    = 요구사항 밖의 변경 수/범위
Clarification count = 실제 사용자에게 추가로 요구한 질문 라운드 수
Skill overhead      = 스킬 탐색·본문 로딩·훅·서브에이전트 시작 비용
```

### 초기 목표 — 성과가 아닌 가설

| 지표 | C 목표(동일 모델의 A와 비교) | 비고 |
|---|---|---|
| 완료 시간 | 20% 이상 단축 | 중앙값/paired 분석 |
| 실효 토큰 비용 | 25% 이상 절감 | 사용량 확인 가능한 실행만 별도 분석 |
| 수용 기준 통과율 | A 이상 | 품질 열화 허용하지 않음 |
| 심각한 결함 | A 이하 | 소수 사례에서 단정 금지 |
| 불필요한 diff | A 이하 | 사용자 검토와 자동 검사 병행 |
| 추가 질문 횟수 | A 이하가 바람직 | 필수 질문 억압 금지 |

**실패 시 의사결정**:
- C가 FAST에서 느리면 해당 유형은 기본 CLI 직접 처리로 우회.
- C가 DEEP에서 비용이 높으면 반복 분석·과잉 병렬·중복 리뷰의 원인을 찾음.
- B가 C보다 품질이 높으면 특정 전문 스킬 조합을 C에서 선택적으로 활성화.
- 개선이 일관되지 않으면 무리한 모델 학습보다 결정적 라우팅 규칙 유지.

## 13.4 조합 학습(Skill Combination Learning)

초기 버전에는 온라인 강화학습 대신 **실험 이력 기반 추천**을 구현한다.

```ts
type SkillOutcome = {
  host: string;
  model: string;
  taskFingerprint: string;  // 민감 데이터 제거된 특징값
  taskMode: "FAST" | "STANDARD" | "DEEP";
  skillIds: string[];
  runId: string;
  verificationPassed: boolean;
  wallTimeMs: number;
  reportedTokens?: number;
  actualCostUsd?: number;
  estimatedCostUsd?: number;
  retries: number;
  defects: number;
};
```

- 비슷한 과제를 찾되 민감한 요청 원문을 임베딩 서비스에 무단 전송하지 않는다.
- 성공률/시간/비용 비교 시 같은 모델 및 작업 난이도 그룹으로 정규화한다.
- 검증 수 부족일 때 과적합하지 않고 기본 정책을 유지한다.
- 추천이 실제로 채택·성과로 이어졌는지 기록하여 후속 개선한다.

---

# 14. 단계별 구현 로드맵과 산출물

## Phase 0 — 설치 환경 감사 및 기준선 기록

**구현**: `aso doctor`, CLI 버전 탐지, 스킬/훅/설정 중복 탐지, 기존 파일 백업 설계, A 기준선 실행 시나리오 정의.

**완료 조건**:
- 세 CLI 설치 여부를 정직하게 표시
- ECC 중복 설치·Graphify 설정 충돌·메모리 중복 주입 위험을 탐지
- 사용자의 설정을 자동 수정하지 않음

## Phase 1 — Native Skill MVP (가장 우선)

**구현**: `SKILL.md` 정본, CLI entrypoint, FAST/STANDARD/DEEP, 공통 정책, 최소 라우터 설명, 요구사항 및 plan 템플릿.

**완료 조건**:
- 동일 요청을 각 CLI에 전달했을 때 목표·수용 기준·실행 모드·선택 스킬을 구조화 출력
- 작은 작업은 여러 서브에이전트 없이 진행
- 중복된 planner/memory 사용을 기본적으로 피함

## Phase 2 — Registry + Router + ECC

**구현**: 로컬 인덱스, 메타데이터 파싱, 해시/잠금, capability scoring, 충돌/의존 관계, ECC specialist-only, find-skills 필요 시 호출.

**완료 조건**:
- 중복 스킬 제거/경고
- 없는 스킬은 승인 대기 후보로만 표시
- ECC 전체 자동 설치 없음

## Phase 3 — DAG + Scheduler + CLI Adapters

**구현**: 타입 검증, 위상 정렬, 워커 작업 분배, 병렬 수 제한, 파일 충돌 검사, worktree 분리, timeout/retry, 세 CLI별 JSON 이벤트 정규화.

**완료 조건**:
- 독립 작업은 병렬, 의존 작업은 순차
- 작업 실패가 종속 작업에 적절히 전파
- stdout/stderr/실행 결과를 재현 가능하게 기록

## Phase 4 — Graphify/Memory/Cache/Budget

**구현**: Graphify 조건부 탐색, claude-mem 3단계 검색, Context packer, 가능한 범위에서 실측 Usage, 비용 계측, 비밀정보 마스킹.

**완료 조건**:
- 해당 조건이 아닌 FAST 요청은 그래프/메모리 전체 로딩하지 않음
- 지원되지 않는 토큰 필드는 `unknown` 처리
- 고비용 재시도·과도한 하위 에이전트 비용을 가시화

## Phase 5 — Benchmarks + Auto-tuning

**구현**: A/B/C 실행/홀드아웃, 테스트 채점기, 통계 보고, skill outcome 기록 및 안전한 규칙 업데이트.

**완료 조건**:
- 호스트별 A/B/C 비교 결과 재현 가능
- 시간/비용/품질이 각각 분리돼 보고됨
- 실제 검증을 통과하지 않은 개선 수치가 문서/제품에 표시되지 않음

## 구현 우선순위 핵심

`실행 모드 분류 → 로컬 Skill Registry → 요구사항 고도화 → DAG/워커 → ECC specialist → 메모리/캐시 → 벤치마크/자동 개선`.

**한 번에 전체를 만드는 것보다** Phase 1~2를 완성하고 작은 과제에서 성능을 검증하면서 확장한다.

---

# 15. 보안, 라이선스, 운영 리스크

## 15.1 외부 Skill 공급망

- 설치 전에 소스 저장소, 소유자, 버전/커밋, 라이선스, 실행 스크립트, 훅, 권한, 네트워크 사용을 검사.
- 원격 스킬 README/SKILL.md의 지시는 신뢰할 수 없는 입력으로 취급한다. 사용자 명령 및 로컬 정책보다 상위로 승격시키지 않는다.
- dependency confusion/동일 이름 스킬 충돌/설치 경로 덮어쓰기 탐지.
- lockfile + hash mismatch 시 실행 전 경고.
- ECC와 다른 플러그인의 훅이 둘 다 파일 접근을 가로채는 경우 단일 정책 선택.

## 15.2 명령 실행 안전

- 명령 인자를 배열로 처리하고 셸 확장 차단.
- 외부 도메인 호출, 유료 모델 호출, 대량 파일 수정, 운영 배포에는 단계별 승인 정책 적용.
- 가능한 최소 접근권한, 타임아웃, 샌드박스, 네트워크/파일 접근 제한 사용.
- 인증정보는 환경 변수 allowlist 또는 운영체제 credential manager로 주입하며 로그에 기록하지 않는다.
- 사용자 프롬프트에 포함된 명령을 무조건 쉘에서 실행하지 않는다.

## 15.3 메모리와 프라이버시

- 민감정보 원문 저장 기본 OFF.
- claude-mem의 자동 capture/클라우드 동기화 옵션은 설치 시 실제 동작을 확인한다.
- 여러 호스트 간 기록 공유는 정보 민감성과 명시 동의를 기준으로 한다.
- 기록 보존 기간과 삭제 수단을 명시한다.

## 15.4 Graceful degradation

| 실패 상황 | 행동 |
|---|---|
| ECC 없음 | 기본 내장 역량 + 기존 테스트로 수행 |
| Graphify 없음/그래프 만료 | `ripgrep`/파일 탐색 등 기본 경로 사용 |
| claude-mem 없음 | 현재 저장소와 결정 문서에만 근거 |
| find-skills 실패 | 불필요한 반복 없이 로컬 역량만 사용/부족 보고 |
| 캐시 정보 없음 | 캐시 성능 지표만 `unknown` 처리 |
| CLI가 usage를 안 줌 | 시간·품질은 계속 측정, 토큰 비교는 결측 처리 |
| 외부 모델 호출 실패 | 회복 가능한 오류에 제한 재시도, 단계별 상태 저장 |

---

# 16. 최종 인수 기준 (Definition of Done)

아래를 모두 만족해야 제품 구현이 완료된 것으로 간주한다.

- [ ] `aso doctor`, `skills list`, `plan`, `run`, `report`, `benchmark` 명령 동작
- [ ] 세 CLI 각각에서 최소 한 개의 통합 smoke test 통과(테스트한 버전 명시)
- [ ] 호스트별 스킬 설치 경로/입력/출력 차이가 어댑터로 추상화됨
- [ ] FAST/STANDARD/DEEP가 같은 요청에 대해 재현 가능한 판정 근거를 기록
- [ ] 본문 지연 로딩 및 스킬 조합 충돌 방지 테스트 통과
- [ ] Superpowers와 ECC가 동시에 최상위 planner로 동작하지 않음
- [ ] claude-mem/ECC memory가 중복으로 자동 주입되지 않음
- [ ] 새로운 외부 스킬은 설치 승인 전 절대로 실행되지 않음
- [ ] DAG cycle·파일 충돌·실패/재시도/중단·worktree 병합 테스트 통과
- [ ] 실측 사용량과 추정 비용을 구분하고 결측을 임의로 채우지 않음
- [ ] 사용자의 기존 프로젝트 파일·플러그인 설정을 파괴하지 않음
- [ ] 실제 검증 명령/결과/근거가 보고서에 있음
- [ ] A/B/C 실험은 동일 조건·홀드아웃·캐시 상태를 통제하여 실행
- [ ] 목표 20%/25%는 결과가 나오기 전까지 '가설'로만 표기
- [ ] README에 설치/사용/문제해결/되돌리기/보안 경계 설명

---

# 17. 구현 중 의사결정 규칙 / ADR

## ADR-001: ECC specialist-only
- 결정: ECC는 전문 기능 공급자로 사용하고 오케스트레이션 자체는 ASO가 관리.
- 이유: Superpowers/내부 planner와 중복될 때 토큰과 동작 충돌 위험.
- 검증: ECC 스킬별 A/B에서 품질·비용 순이득이 있을 때만 활성 범위 확대.

## ADR-002: 단일 최상위 관리자
- 결정: 작업 실행·예산·품질 게이트의 최종 소유자는 ASO 하나.
- 이유: 중복 계획·메모리·재시도·검증 방지.

## ADR-003: 작은 작업은 기본 단일 실행
- 결정: FAST에서 병렬 워커, Graphify 전체 그래프, 깊은 인터뷰를 기본 생략.
- 이유: 오버헤드가 작업 비용보다 클 수 있음.

## ADR-004: 세 CLI 공유 스킬 + 얇은 adapter
- 결정: 공통 Agent Skills SKILL.md + CLI별 지침/런타임 어댑터.
- 이유: 스킬 본문은 재사용 가능하지만 CLI의 설정·활성화·이벤트 형식은 다름.

## ADR-005: 계측 불가능한 사용량은 unknown
- 결정: 실제 사용량과 환산값을 혼동하지 않음.
- 이유: 최적화 근거의 신뢰성 보존.

## ADR-006: 검증된 조합의 점진적 재사용
- 결정: 규칙 기반 라우터로 시작하고 홀드아웃 실험 결과로만 조정.
- 이유: 소규모 데이터에서 학습 기반 선택은 과적합 위험이 큼.

---

# 부록 A. 실행용 에이전트 프롬프트 (Claude / Codex / Gemini 공통)

아래 문구를 프로젝트 루트에서 각 CLI에 붙여넣는다. **이 문서가 `docs/ASO_SPEC.md`로 배치되어 있다고 가정한다.**

```text
당신은 이 저장소의 구현 책임자다.

1) docs/ASO_SPEC.md 전체를 읽고 요구사항·금지사항·수용 기준을 추출하라.
2) 기존 CLAUDE.md, AGENTS.md, GEMINI.md, SKILL.md, 설치된 ECC/Graphify/claude-mem, 현재 Git 상태를 먼저 조사하라. 기존 설정이나 사용자 파일을 무단 덮어쓰지 마라.
3) 'Phase 0 → Phase 1 → 테스트'부터 시작하라. 기존 구현이 이미 있으면 차이를 분석해 재사용하고 중복 작성하지 마라.
4) npm/TypeScript 프로젝트를 최소한의 의존성으로 구성하라. 스키마, Skill Registry, FAST/STANDARD/DEEP, 안전한 실행 전략, 보고서 출력을 우선 구현하라.
5) 외부 플러그인 설치, 네트워크 연동, 비밀정보 접근, 파괴적 변경은 사용자 승인 없이 실행하지 마라. 현재 CLI의 공식 문서/--help로 실제 지원 명령을 검증하라.
6) 단위 테스트·mock 통합 테스트·문서화·간단한 실행 예제를 작성하고 실행하라. 실행한 테스트만 통과했다고 보고하라.
7) README에 빠른 시작, CLI별 설정, 구성 파일 설명, 테스트, 롤백 방법을 남겨라.
8) 종료 시 변경 파일, 테스트 명령/실제 결과, 구현 완료 항목, 미구현 항목, 현재 비용 계측 가능 여부를 간결하게 보고하라.

최적화보다 정확성, 데이터 보호 및 테스트를 우선한다. 추측한 API/CLI 기능을 실제 작동 사실처럼 작성하지 마라.
```

### CLI에서 사용 예시

```bash
# Claude Code 대화형: 프로젝트 루트에서
claude
# 이후 부록 A 프롬프트 입력

# Codex CLI 대화형
codex
# 이후 부록 A 프롬프트 입력

# Gemini CLI 대화형 (실제 계정/배포의 이용 가능 여부 확인)
gemini
# 이후 부록 A 프롬프트 입력
```

**참고**: 2026년에는 CLI의 기능·배포 대상·계정 지원이 빠르게 바뀔 수 있다. 특히 Gemini CLI의 현재 README는 계정·상품군별 지원 범위의 변화를 설명하므로 설치 전 이를 반드시 확인한다. 모델 자체가 문서를 읽는다고 해서 설치나 실행이 자동으로 보장되는 것은 아니다.

---

# 부록 B. 공통 `SKILL.md` 초안

아래 내용은 `.agents/skills/adaptive-orchestrator/SKILL.md`로 추출해 사용할 수 있는 최소 구현본이다. 현재 문서 전체를 매 작업마다 읽는 것보다 **짧은 본문 + 단계별 references** 방식이 좋다.

````markdown
---
name: adaptive-orchestrator
description: Refine ambiguous development requests, select a minimal compatible skill set, plan and implement with dependency-aware execution and real verification. Use for multi-step coding and architecture tasks.
---

# Adaptive Skill Orchestrator

You are the single top-level orchestration authority for the current development task.

## 1. Understand
- Extract objective, constraints, assumptions and measurable acceptance criteria.
- Ask only blocking/high-impact questions; proceed with explicit reversible defaults otherwise.

## 2. Classify
- FAST: narrow, low-risk; minimal plan and no unnecessary workers.
- STANDARD: bounded multi-step; lightweight plan, limited specialization.
- DEEP: high risk/complexity; detailed DAG, specialized skills, stronger verification.

## 3. Route
- Search the existing local registry first.
- Choose the minimum compatible skills for each phase.
- ECC provides specialist capabilities, not a competing top-level planner.
- Superpowers provides process techniques only when relevant.
- Karpathy/Ponytail simplicity principles apply in compressed form.
- Use Graphify for complex code relationships; claude-mem only for relevant history.
- Discover uninstalled external skills only when needed, and never install them without approval.

## 4. Execute
- Create a task DAG with clear dependencies, write scopes and acceptance criteria.
- Parallelize only independent work; isolate conflicting writes.
- Give workers scoped context and bounded execution budgets.

## 5. Verify and report
- Run relevant tests and inspect the final diff.
- Keep provider-reported tokens separate from estimates; use unknown when unavailable.
- Report changed files, executed tests, risks, blocked items and actual results.
- Never claim a test passed unless it was run and passed.

Full contracts and policies: docs/ASO_SPEC.md.
````

> 본 `SKILL.md`는 **명세 초안**이다. 원본 슈퍼파워/ECC 각 프로젝트의 실제 스킬 ID, invocation 형태와 경로는 설치 환경에서 조사한 뒤 Registry에 매핑한다.

---

# 부록 C. 참고 자료와 검증 근거

아래는 구현 시 사용할 **공식 문서 또는 해당 프로젝트의 원본 저장소**다. 저장소의 README·설치 옵션·CLI 플래그는 변경될 수 있으므로 특정 버전에 고정하고 사용한다.

1. Everything Claude Code (ECC): https://github.com/affaan-m/ECC
2. Superpowers: https://github.com/obra/superpowers
3. Karpathy-inspired skills: https://github.com/swarmclawai/andrej-karpathy-skills
4. Matt Pocock skills: https://github.com/mattpocock/skills
5. Graphify: https://github.com/Graphify-Labs/graphify
6. claude-mem: https://github.com/thedotmack/claude-mem
7. Ponytail: https://github.com/DietrichGebert/ponytail
8. Claude Code Skills documentation: https://code.claude.com/docs/en/skills
9. Claude Agent Skills architecture: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
10. Codex agent skills: https://developers.openai.com/codex/skills
11. Codex skill development: https://learn.chatgpt.com/docs/build-skills?product=breeze
12. Gemini CLI skills: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
13. Gemini CLI reference: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md
14. Gemini CLI headless automation: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/automation.md
15. Anthropic Prompt Caching docs: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
16. OpenAI skill evaluations: https://developers.openai.com/blog/eval-skills

## 최종 설계 요약

**이 프로젝트의 핵심 기술은 스킬의 수가 아니라, 요구사항 정규화·역량 기반 선택·의존성 병렬 처리·컨텍스트 예산·검증 데이터로 구동되는 '작업 적응형 오케스트레이터'다.**

- ECC: **선별 편입**한다.
- Superpowers: **절차를 빌리되** 다른 상위 관리자와 경쟁시키지 않는다.
- Karpathy + Ponytail: **짧은 원칙으로 합쳐서** 코드 과잉을 방지한다.
- Matt Pocock: **애매함이 결과를 바꾸는 경우에만** 심층 질문한다.
- Graphify + claude-mem: **필요에 따라서만** 관련 정보 검색한다.
- find-skills: **로컬 역량이 부족할 때만** 외부 탐색한다.
- Prompt caching: **지원되는 런타임에서 측정 기반으로** 최적화한다.
- 병렬화: **독립 작업에만**, 통합·회귀 테스트는 반드시 수행한다.
- 승패: **A/B/C에서 속도·실효 비용·품질을 동시에 검증**한다.

**End of specification.**
