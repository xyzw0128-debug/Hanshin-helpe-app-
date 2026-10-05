#!/usr/bin/env bash
# 배포용(릴리스) APK 만들기: 웹 빌드 → 안드로이드 동기화 → 서명된 APK → 프로젝트 폴더에 복사
# 사용법: npm run build:release
# 서명 비밀번호는 입력할 때 화면에 보이지 않으며, 파일에 저장하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
gradle_version=$(grep -m1 'versionName' android/app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')
version_code=$(grep -m1 'versionCode' android/app/build.gradle | sed -E 's/[^0-9]*([0-9]+).*/\1/')
if [ "$version" != "$gradle_version" ]; then
  echo "버전이 서로 달라요: package.json=$version, build.gradle=$gradle_version" >&2
  echo "두 값을 같게 맞춘 뒤 다시 실행해 주세요." >&2
  exit 1
fi
echo "▶ 버전 $version (versionCode $version_code)"

if [ ! -f android/app/hs-lms.keystore ]; then
  echo "서명 키 파일(android/app/hs-lms.keystore)이 없어요." >&2
  exit 1
fi

# 환경변수로 이미 넣었으면 그대로 쓰고, 아니면 물어봄
if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -rsp "키스토어 비밀번호 (storePass): " KEYSTORE_PASSWORD
  echo
fi
if [ -z "${KEY_PASSWORD:-}" ]; then
  read -rsp "키 비밀번호 (keyPass, storePass와 같으면 그냥 Enter): " KEY_PASSWORD
  echo
  KEY_PASSWORD=${KEY_PASSWORD:-$KEYSTORE_PASSWORD}
fi
export KEYSTORE_PASSWORD KEY_PASSWORD

echo "▶ 1/3 웹 빌드"
npm run build

echo "▶ 2/3 안드로이드에 반영"
npx cap sync android

echo "▶ 3/3 서명된 APK 만들기 (처음에는 몇 분 걸릴 수 있어요)"
(cd android && ./gradlew assembleRelease)

built=android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$built" ]; then
  echo "APK를 찾지 못했어요: $built" >&2
  exit 1
fi

out="lms-notifier-v${version}.apk"
if [ -e "$out" ]; then
  out="lms-notifier-v${version}-$(date +%Y%m%d-%H%M).apk"
fi
cp "$built" "$out"
size=$(du -h "$out" | cut -f1)
echo
echo "✅ 완료: $(pwd)/$out ($size)"
echo "   이 파일을 휴대폰으로 옮겨 설치하면 돼요."
