# Gon

Gon은 한 줄 아이디어를 질문(그릴링), 기획, 점검 및 사용자 승인, 작업 구성, 전문가 병렬 실행, 결과 종합 및 검증의 7단계로 수행하는 AI 에이전트용 스킬팩입니다.

진행 상황은 프로젝트 폴더 안 `.gon/` 기록으로 남으며, 필요할 때 읽기 전용 로컬 그래프 화면을 열어 각 단계와 전문가가 수행한 작업을 점과 선으로 확인할 수 있습니다.

## 설치

```bash
claude plugin marketplace add 2Jaegon/Gon
claude plugin install gon@gon
```

설치 후 `/reload-plugins`를 입력하거나 세션을 재시작하세요. 삭제할 때는 `claude plugin uninstall gon@gon`을 실행합니다.
