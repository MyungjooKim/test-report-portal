# Changelog

## [0.4.0] - 2026-07-15

### Added — 리포트 AI Q&A + 커스텀 통계 카드
- **AI 에게 질문**: Sheets 리포트 대시보드에서 자연어로 결과 데이터 질의 (Claude 기반, 스트리밍 답변, 추천 질문 칩)
- **계산식 기반 커스텀 지표**: 수치 질문은 AI 가 계산 정의(필터+집계)를 만들고 **숫자는 서버가 계산** (환각 차단).
  답변의 계산 결과를 "📌 대시보드에 추가"하면 기본 통계 카드 옆에 영구 카드로 — 시트 새로고침 시 자동 재계산
- 커스텀 카드 삭제 (AI 추가 카드 한정, 확인 다이얼로그)
- 시트 원본 rows 보존 (`data/sheets/{id}.json`) — 가져오기/새로고침 시 저장, 리포트 삭제 연동
- `lib/metric-eval` 계산기 + 단위 테스트 (`npm test`)
- 신규 env: `ANTHROPIC_API_KEY` (미설정 시 AI 기능 자동 비노출)

### Fixed
- Dockerfile 에 `lib/` 복사 누락

## [0.3.0 ~ 0.3.1] - 2026-07-15

### Added — QA 통합 (TC Generator SSO)
- `INTEGRATED=1` 모드: 자체 Google 로그인 대신 **tcgen 세션 신뢰** — 로그인은 tcgen 으로 위임,
  세션 검증은 tcgen `/whoami` 쿠키 포워딩 (5분마다 재검증 — 교차 로그아웃 전파)
- 우상단 **9-dot 앱 런처** (TC Generator ↔ TR Portal 전환)
- 서버 주도 `/logout`: 포털 세션 파기 → tcgen 로그아웃 연쇄 (양쪽 동시 종료)
- Google Sheets 가져오기/새로고침이 통합 로그인 토큰으로 동작 (tcgen `/whoami/token` 연동 — 재로그인 불필요)
- 사이드바 폭 드래그 리사이즈 (240~560px, localStorage 저장, 더블클릭 초기화)
- 신규 env: `INTEGRATED`, `TCGEN_URL`(서버 검증용), `TCGEN_PUBLIC_URL`(브라우저용)

### Changed
- `INTEGRATED` 미설정 시 기존 자체 로그인 동작 그대로 (배포 회귀 없음)
- deploy.sh 헬스체크가 통합 모드의 /login 302 도 정상으로 판정

## [0.2.0] - 2026-06-29

### Added
- 검색 기능 (메타데이터 인덱싱 + 프로젝트 스코프 필터 + 키워드 하이라이트)
- Google Sheets 연동 (URL 또는 ID로 가져오기, 새로고침)
- 리포트 대시보드 (Pass Rate, 실행률, 시트별 통계, Fail 목록)
- Google OAuth 로그인 필수 (포털 전체 인증)
- 비공개 프로젝트 (생성자만 조회 가능)
- 로딩 오버레이 + 토스트 알림
- 세션 파일 저장 (컨테이너 재시작해도 유지)
- ship/pull/deploy 스크립트 (브랜치 전략 워크플로우)
- README.md 최신화

### Changed
- 컬럼 폭 규칙 개선 (헤더명 기반 + 데이터 길이 기반)
- 로그아웃 아이콘 개선
- 브랜치 구조 정리 (main ← develop ← feature)
- 서버 포트 6000으로 변경

## [0.1.0] - 2026-06-26

### Added
- 프로젝트 계층 구조 (최대 3 depth 폴더)
- 프로젝트 이름 인라인 편집
- Markdown 파일 업로드 및 렌더링 뷰어
- 사이드바 드래그앤드롭 순서 변경
- 브라우저 뒤로가기/앞으로가기 지원 (hash 라우팅)
- ZIP 폴더 업로드 (스크린샷 등 리소스 포함)
- Docker 지원
- 버전 표기 (사이드바 하단)

## [0.0.1] - 2026-06-26

### Added
- 프로젝트 생성/삭제
- HTML 리포트 업로드 및 iframe 뷰어
- 날짜별 리포트 그룹핑
- 대시보드 통계
