# 한신대 LMS 알리미 (lms-notifier-app)

한신대학교 LMS(`lms.hs.ac.kr`)와 종합정보시스템 HSCTIS(`hsctis.hs.ac.kr`)를 스크래핑해 과제·강의·공지·성적·시간표를 보여주고 알림을 보내는 Android 앱.
Vite + React 18 + TypeScript + Tailwind 웹앱을 Capacitor 6으로 감싼 구조. UI 문구와 코드 주석은 한국어.

## 명령어

```bash
npm run dev            # Vite 개발 서버 (port 3000, /api/proxy 로 학교 서버 프록시)
npm run build          # tsc + vite build → dist/
npx cap sync android   # dist/ 를 android/app/src/main/assets/public 으로 복사
cd android && ./gradlew assembleRelease   # 서명된 APK (KEYSTORE_PASSWORD, KEY_PASSWORD 환경변수 필요)
npm run pack:zip       # 상위 폴더에 소스 zip 생성
```

릴리스 빌드 전체 흐름은 `/build-apk` 스킬 참고.

## 구조

- `src/services/` — 핵심 로직
  - `lmsAuth.ts`, `hsctisAuth.ts` — SSO(`sso2.hs.ac.kr`) OAuth 로그인 후 각 시스템 세션 확립
  - `lmsScraper.ts` — LMS HTML(`*.dunet`) 정규식 파싱
  - `hsctisScraper.ts`, `nexacroClient.ts` — HSCTIS 넥사크로 SSV 프로토콜 통신
  - `httpClient.ts` — 네이티브에선 `CapacitorHttp`, 웹(dev)에선 `/api/proxy` 경유
  - `gemini.ts` — 공지 요약 (사용자가 입력한 Gemini API 키 사용, 실패 시 `localFallbackSummary`)
  - `storage.ts` — 비밀번호 등은 `@aparajita/capacitor-secure-storage`, 나머지는 Preferences
  - `backgroundSync.ts` — Java `BackgroundSync` 플러그인 브리지 (마감 알림 목록 `syncNativeReminders`, 알림 설정 전달 포함)
  - `appShell.ts` — Java `AppShell` 플러그인 브리지: 뒤로가기 상태, 알림·위젯으로 연 화면, 배터리·알림 권한 설정, 캘린더 추가
  - `backNav.ts` — 안드로이드 뒤로가기: 열린 창(`useBackHandler`) → 이전 화면(`utils/navHistory.ts`) → 홈 → 두 번 눌러 종료. WebView history는 쓰지 않음
  - `updateCheck.ts` — GitHub Releases 최신 버전 확인 (Play 스토어가 아니라 자동 업데이트가 없음)
- `src/components/`, `src/hooks/useLmsSync.ts` — UI와 동기화 상태
- `android/app/src/main/java/kr/ac/hs/lmsnotifier/` — 네이티브 플러그인
  - `BackgroundSyncWorker.java` — WorkManager 백그라운드 동기화. `doTodoList.dunet` 파싱은 **`TodoListParser.java`에 Java로 따로 구현**. 진행 중 목록(`proceedable`)으로 새 과제·강의, 완료 목록(`complete`)으로 새 과목 공지와 제출 완료를 확인
  - `DeadlineReminders.java` — 마감 하루 전·3시간 전 알림(AlarmManager). 앱이 목록 전체를 넘기고 워커가 이어서 고침. `BootReceiver`가 재부팅 뒤 다시 예약, `DeadlineWidgetProvider`(홈 화면 위젯)가 같은 목록을 보여 줌
  - `MainActivity.java`, `AppShellPlugin.java` — 뒤로가기(웹 화면이 알려 준 상태로 판단), 알림을 눌러 연 화면 전달
  - `NativeAppLauncherPlugin.java` — 다른 캠퍼스 앱 실행
- `vite.config.ts` — 개발용 프록시 미들웨어. 쿠키를 도메인별로 저장해 브라우저에서도 SSO 흐름이 동작하게 함
- `tests/*.mjs` — 실제 학교 서버에 로그인하는 수동 통합 테스트 (`.env`의 `HS_USER_ID`/`HS_USER_PW` 사용)

LMS·HSCTIS 엔드포인트와 로그인 흐름 상세는 `.claude/skills/lms-protocol/SKILL.md`에 있음.

## 주의사항

- **TS/Java 이중 구현**: LMS todo 목록 파싱(`lmsScraper.ts`의 `getTodoList`)을 바꾸면 `TodoListParser.java`(백그라운드 워커용)도 같이 맞춰야 함. 항목 ID가 다르면 중복 알림이 가므로 `npm test`의 Test 38이 두 파서의 ID 일치를 HAR로 검증함(JDK 필요). 플러그인 메서드를 추가하거나 바꾸면 `@PluginMethod`와 `registerPlugin` 인터페이스를 함께 수정. 밀리초 시각 같은 큰 숫자는 JSON에서 Long으로 와서 `call.getDouble`/`getInt`로 읽히지 않으므로 `call.getData().optLong(...)`을 쓸 것.
- **SSO 재로그인은 PC 세션을 끊는다**: `login()`은 `isSessionValid()`를 먼저 확인함. 로그인 호출을 늘리지 말 것.
- **테스트는 실제 계정으로 학교 서버에 접속**한다. 반복 실행하거나 루프로 돌리지 말고, 실행 전에 사용자에게 확인.
- **비밀 정보**: `.env`, `android/app/hs-lms.keystore`는 읽거나 수정하지 않음(hook과 deny 규칙으로 막혀 있음). 키스토어를 잃거나 망가뜨리면 기존 설치본에 업데이트를 배포할 수 없음.
- 로그나 디버그 출력에 학번·비밀번호·쿠키가 들어가면 `debugLog.ts`의 `redactSensitive`를 거칠 것. 세션을 구분해야 하면 값 대신 `DebugLog.sessionTag`(해시 앞 6자리)를 남김.
- **네이티브에서 `HttpURLConnection`에 Cookie 헤더를 직접 넣지 말 것**(앱 프로세스가 떠 있을 때): Capacitor가 전역 `CookieHandler`를 등록해 두어 CookieManager 쿠키가 자동으로 한 줄 더 붙고, 두 줄이 되면 LMS가 모든 요청을 "잘못된 경로입니다"(HTTP 500)로 거부함. 워커는 핸들러가 없을 때(앱이 꺼진 프로세스)만 직접 넣음.
- `tsconfig`는 `strict: false`. 린터·포매터는 없고, `.ts/.tsx`를 수정하면 hook이 `tsc --noEmit`을 자동 실행함.
- `dist/`, `android/app/src/main/assets/public/`은 생성물이므로 직접 수정하지 말고 `src/`를 고친 뒤 다시 빌드.
- 버전을 올릴 때는 `package.json`의 `version`과 `android/app/build.gradle`의 `versionCode`/`versionName`을 함께 수정.
