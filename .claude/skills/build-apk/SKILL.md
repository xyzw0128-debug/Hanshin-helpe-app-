---
name: build-apk
description: 웹앱 빌드 → Capacitor sync → Gradle로 Android APK를 만들어 프로젝트 루트에 복사한다. 인자로 debug 또는 install을 줄 수 있다.
disable-model-invocation: true
argument-hint: "[debug] [install]"
---

# APK 빌드

인자: `$ARGUMENTS`
- `debug` 포함 → `assembleDebug` (서명 불필요). 없으면 `assembleRelease`.
- `install` 포함 → 빌드 후 연결된 기기에 `adb install -r`.

## 순서

1. **버전 확인**: `package.json`의 `version`과 `android/app/build.gradle`의 `versionName`/`versionCode`를 읽어 보여준다. 둘이 다르면 멈추고 사용자에게 어떻게 맞출지 묻는다. 릴리스인데 이전 빌드와 `versionCode`가 같으면 올릴지 묻는다.

2. **웹 빌드**: `npm run build`. 실패하면 tsc 에러를 고치고 다시 실행한다.

3. **동기화**: `npx cap sync android`

4. **릴리스 서명 확인** (release일 때만): 값은 절대 출력하지 말고 존재 여부만 확인한다.
   ```bash
   [ -n "$KEYSTORE_PASSWORD" ] || grep -q '^KEYSTORE_PASSWORD=' ~/.gradle/gradle.properties 2>/dev/null && echo ok || echo missing
   ```
   `missing`이면 멈추고, 사용자가 직접 `export KEYSTORE_PASSWORD=... KEY_PASSWORD=...`를 설정하거나 `~/.gradle/gradle.properties`에 넣도록 안내한다. 비밀번호를 대신 입력하거나 파일에 쓰지 않는다.

5. **Gradle 빌드**:
   ```bash
   cd android && ./gradlew assembleRelease   # 또는 assembleDebug
   ```

6. **결과물 복사**: `android/app/build/outputs/apk/<release|debug>/` 안의 APK를 프로젝트 루트에 `lms-notifier-v<versionName>[-debug].apk`로 복사한다. 기존 APK는 덮어쓰지 않는다. 같은 이름이 있으면 사용자에게 묻는다.

7. **설치** (`install`일 때): `~/Android/Sdk/platform-tools/adb devices`로 기기를 확인한 뒤 `adb install -r <apk>`. 서명이 달라 실패하면(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) 앱을 삭제하지 말고 사용자에게 알린다.

8. 마지막으로 APK 경로, 크기, 버전을 한 줄로 보고한다.
