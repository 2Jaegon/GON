import { describe, it, expect } from 'vitest';
import { classifyMode } from '../../cli/src/core/classifier.js';

describe('classifyMode', () => {
  it('classifies single-file typo / comment fix as FAST', () => {
    const res1 = classifyMode('오타 수정해줘', { files: 1 });
    expect(res1.mode).toBe('fast');

    const res2 = classifyMode('주석 문구 조금 다듬어줘', { files: 2 });
    expect(res2.mode).toBe('fast');
  });

  it('classifies auth / permission / payment / destructive changes as DEEP', () => {
    const res1 = classifyMode('로그인 OAuth 인증 로직 추가', { files: 1 });
    expect(res1.mode).toBe('deep');
    expect(res1.signals).toContain('인증');

    const res2 = classifyMode('결제 테이블 마이그레이션 및 기존 데이터 삭제');
    expect(res2.mode).toBe('deep');
  });

  it('classifies general multi-step feature tasks as STANDARD', () => {
    const res = classifyMode('할 일 목록에 완료 여부 필터링 기능 추가');
    expect(res.mode).toBe('standard');
    expect(res.signals).toEqual([]);
  });
});

