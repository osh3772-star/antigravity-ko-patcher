# Antigravity 2.0 한국어 패치 도구 (Korean Localization Patcher)

Antigravity 2.0 데스크톱 애플리케이션(`app.asar` 네이티브 셸 및 `BrowserWindow` 웹 UI)을 비파괴적(Non-destructive) 방식으로 한글화하는 자동 패치 도구입니다.

---

## 주요 기능

1. **2-Tier 하이브리드 한글화**
   - **네이티브 셸 (`app.asar`)**: 시스템 트레이 메뉴, 상단 앱 메뉴, 종료 확인 창, IDE 설치 마법사 등 패치
   - **웹 UI 런타임 (`i18n-runtime.js`)**: 좌측 사이드바, 채팅 캔버스, 우측 보조 패널(서브에이전트, 백그라운드 작업, 아티팩트 등), 설정(Settings) 화면 전체 실시간 한글화
2. **코드 및 터미널 안전 보호 필터 (Safe-Guard)**
   - `<pre>`, `<code>`, Prism/Monaco 코드 에디터, 터미널(`.xterm`), 파일 뷰어 본문, 사용자 입력창은 번역 대상에서 철저히 제외합니다.
3. **실시간 한/영 즉시 토글 (`Alt + Shift + K` 또는 `Ctrl + Alt + L`)**
   - 앱 재시작이나 새로고침 없이 단축키 한 번으로 **한국어 $\leftrightarrow$ 영어(원문)**를 즉시 전환할 수 있습니다.
4. **미번역 문구 자동 수집기 (`Ctrl + Alt + Shift + L`)**
   - 현재 화면에 남아 있는 미번역 영문 UI 라벨을 자동으로 스캔하여 클립보드에 JSON 형식으로 복사합니다.
5. **외부 사전 연동 (`locales/ko-KR.json`)**
   - `locales/ko-KR.json` 파일만 수정한 뒤 `.\patch.ps1 -Action live`를 실행(또는 앱에서 `Ctrl+R` 새로고침)하면 재패키징 없이 즉시 번역이 반영됩니다.

---

## 사용 방법 (PowerShell)

```powershell
# 1. 한글 패치 적용 (원본 백업 + app.asar 패치 + 현재 열린 창 즉시 한글화)
.\antigravity-ko-patcher\patch.ps1 -Action apply

# 2. 사전(locales/ko-KR.json) 수정 후 현재 창에 즉시 반영 (핫리로드)
.\antigravity-ko-patcher\patch.ps1 -Action live

# 3. 패치 상태 및 번역 사전 통계 확인
.\antigravity-ko-patcher\patch.ps1 -Action status

# 4. 원본 영문 상태로 완전 복원 (app.asar.bak 복구)
.\antigravity-ko-patcher\patch.ps1 -Action restore
```

---

## 디렉토리 구조

```text
antigravity-ko-patcher/
├── patch.ps1                 # 원클릭 실행 스크립트 (apply / live / restore / status)
├── src/
│   ├── patcher.js            # ASAR 무결성 재계산 패치 엔진 & 실시간 CDP 주입기
│   └── i18n-runtime.js       # BrowserWindow DOM 실시간 번역 & 단축키 런타임
├── locales/
│   └── ko-KR.json            # 한국어 번역 사전 (네이티브 / 정적 UI / 동적 정규식)
└── README.md                 # 사용 설명서
```
