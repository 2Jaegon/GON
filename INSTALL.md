# Gon 고정 설치 안내 (`INSTALL.md`)

이 문서는 사용자가 AI에게 `"GON 설치해줘"`라고 요청했을 때 AI가 참고하는 고정 명령서입니다.
저장소 공식 주소는 `https://github.com/2Jaegon/Gon` 하나뿐입니다.

## AI 실행 수칙 (필수)
1. 아래 명령을 실행하기 전에 반드시 같은 저장소의 `README.md`에 적힌 설치 명령과 글자 단위로 대조해 일치하는지 확인한다.
2. 실행할 명령 두 줄을 사용자에게 먼저 보여 주고, 사용자의 명시적 승인을 기다린다. 승인 전에는 절대 실행하지 않는다.
3. 이 문서에 적힌 고정 명령 외의 다른 파일 다운로드나 외부 스크립트 실행은 절대 수행하지 않는다.

## 설치 명령 (Claude Code)

```bash
claude plugin marketplace add 2Jaegon/Gon
claude plugin install gon@gon
```

설치 명령이 끝난 뒤에는 사용자에게 `/reload-plugins`를 입력하거나 세션을 재시작하라고 안내한다.

## 삭제 명령 (Claude Code)

```bash
claude plugin uninstall gon@gon
```
