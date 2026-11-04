import { ExecutionMode } from "@aso/contracts";

export interface ClassificationResult {
  mode: ExecutionMode;
  reason: string;
  confidence: number;
  indicators: string[];
}

export class TaskClassifier {
  public classify(request: string): ClassificationResult {
    const text = request.trim().toLowerCase();
    const indicators: string[] = [];

    // 1. Deep indicators
    const deepKeywords = [
      "리팩토링",
      "전면 개편",
      "전체 재설계",
      "아키텍처",
      "마이그레이션",
      "모노레포",
      "보안 감사",
      "refactor",
      "architecture",
      "migration",
      "security audit",
      "full overhaul"
    ];
    for (const kw of deepKeywords) {
      if (text.includes(kw)) indicators.push(`deep:${kw}`);
    }

    if (indicators.length >= 2 || text.includes("전면") || text.includes("overhaul")) {
      return {
        mode: "deep",
        reason: "Detected high-complexity multi-file architectural changes",
        confidence: 0.9,
        indicators
      };
    }

    // 2. Fast indicators
    const fastKeywords = [
      "오타",
      "단순 수정",
      "색상 변경",
      "문구 수정",
      "버전 확인",
      "포맷팅",
      "typo",
      "one line",
      "quick fix",
      "color change",
      "lint"
    ];
    for (const kw of fastKeywords) {
      if (text.includes(kw)) indicators.push(`fast:${kw}`);
    }

    if (indicators.length > 0 && indicators.every((i) => i.startsWith("fast"))) {
      return {
        mode: "fast",
        reason: "Detected isolated single-file lightweight change",
        confidence: 0.85,
        indicators
      };
    }

    // 3. Standard indicators
    const standardKeywords = [
      "기능 추가",
      "버그 수정",
      "엔드포인트",
      "컴포넌트",
      "테스트 추가",
      "만들어",
      "구현",
      "개발",
      "설계",
      "계획",
      "코드",
      "feature",
      "bugfix",
      "endpoint",
      "component",
      "api",
      "build",
      "create",
      "implement"
    ];
    for (const kw of standardKeywords) {
      if (text.includes(kw)) indicators.push(`standard:${kw}`);
    }

    if (indicators.length > 0) {
      return {
        mode: "standard",
        reason: "Standard feature implementation or targeted bug fix",
        confidence: 0.8,
        indicators
      };
    }

    // 4. Chat / Conversational Signals (greetings, identity, casual dialogue)
    const chatKeywords = [
      "ㅎㅇ",
      "안녕",
      "안녕하세요",
      "하이",
      "헬로",
      "반가워",
      "누구야",
      "누구세요",
      "이름이 뭐야",
      "뭐 할 수 있어",
      "할 수 있는 일",
      "자기소개",
      "소개해줘",
      "오늘 날씨",
      "날씨 어때",
      "고마워",
      "감사해",
      "수고했어",
      "잘했어",
      "hello",
      "hi",
      "hey",
      "who are you",
      "what can you do",
      "thanks",
      "thank you"
    ];
    const hasChatIntent = chatKeywords.some((kw) => text.includes(kw));

    if (hasChatIntent || text.length <= 15) {
      return {
        mode: "chat",
        reason: "Detected conversational greeting or general dialogue without plan/build requirements",
        confidence: 0.95,
        indicators: ["chat:conversation"]
      };
    }

    return {
      mode: "standard",
      reason: "Default mode for general development task",
      confidence: 0.7,
      indicators: ["default:standard"]
    };
  }
}

