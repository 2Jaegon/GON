// Waiting label for a chat answer that has not started yet. ES module; also exposed on window for app.js (classic script).
export const SLOW_AFTER_SEC = 20;

export function waitingLabel(name, elapsedSec) {
  const sec = Math.max(0, Math.floor(elapsedSec));
  const base = `${name}가 답변을 쓰고 있어요 · ${sec}초`;
  return sec >= SLOW_AFTER_SEC ? `${base} · 평소보다 오래 걸려요. 시간이 넘으면 오류로 알려드려요.` : base;
}

if (typeof window !== "undefined") {
  window.waitingLabel = waitingLabel;
}
