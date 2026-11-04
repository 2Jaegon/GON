import fs from 'node:fs';
import path from 'node:path';
import { Mode } from './types.js';
import { getProjectRoot } from './env.js';

export interface ClassificationResult {
  mode: Mode;
  reason: string;
  signals: string[];
}

export function classifyMode(
  request: string,
  opts: { files?: number; projectRoot?: string } = {}
): ClassificationResult {
  const reqLower = request.toLowerCase();
  const root = getProjectRoot(opts.projectRoot);
  const riskRulesPath = path.join(root, 'config', 'policies', 'risk-rules.json');

  let deepKeywords = [
    'auth', 'authentication', 'login', 'oauth', '인증', '로그인', '권한', 'permission', 'rbac',
    'payment', '결제', 'billing', '과금',
    'privacy', '개인정보', 'pii', 'secret', '비밀번호', 'password', 'credential',
    'delete', 'drop', 'truncate', '삭제', '제거', 'destructive',
    'migration', '마이그레이션', 'db schema', '스키마',
    'production', 'deploy', '배포', '운영', 'prod',
    'refactor', '리팩터링', '리팩토링', 'architecture', '아키텍처', 'multi-package', '다중 모듈'
  ];

  let fastKeywords = [
    'typo', '오타', 'comment', '주석', '문구', '텍스트', 'rename', '이름변경', '단순수정',
    'docstring', 'readme', '간단', 'quick', 'formatting', '서식'
  ];

  let fastMaxFiles = 2;

  if (fs.existsSync(riskRulesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(riskRulesPath, 'utf8'));
      if (Array.isArray(data.deepKeywords)) deepKeywords = data.deepKeywords;
      if (Array.isArray(data.fastKeywords)) fastKeywords = data.fastKeywords;
      if (typeof data.fastMaxFiles === 'number') fastMaxFiles = data.fastMaxFiles;
    } catch {
      // fallback to defaults
    }
  }

  const matchedDeep = deepKeywords.filter((k) => reqLower.includes(k.toLowerCase()));
  if (matchedDeep.length > 0) {
    return {
      mode: 'deep',
      reason: `고위험/아키텍처 키워드 감지: ${matchedDeep.join(', ')}`,
      signals: matchedDeep,
    };
  }

  const matchedFast = fastKeywords.filter((k) => reqLower.includes(k.toLowerCase()));
  const fileCount = opts.files ?? 1;
  if (matchedFast.length > 0 && fileCount <= fastMaxFiles) {
    return {
      mode: 'fast',
      reason: `경량 수정 키워드 감지 (${matchedFast.join(', ')}), 대상 파일수 ${fileCount} <= ${fastMaxFiles}`,
      signals: matchedFast,
    };
  }

  return {
    mode: 'standard',
    reason: '일반적인 기능 구현 또는 모듈 수정 (중간 범위)',
    signals: [],
  };
}

