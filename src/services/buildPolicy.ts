import { UserConfig } from '../types';
import { isDebugBuild } from './debugLog';

/**
 * 배포(릴리스) 앱에서만 정리하는 기능. 디버그 빌드는 모두 그대로 둔다.
 * (2026-10-05 결정) Gemini 공지 요약, 디스코드 웹훅, PC 로그인 보호 스위치, 설정의 계정 섹션은 배포 앱에서 숨김.
 *
 * 디버그·배포 APK는 같은 웹 빌드(dist)를 쓰므로 빌드 시점이 아니라 실행 시 네이티브 빌드 종류로 판단한다.
 * initDebugLog()가 끝난 뒤에 호출해야 정확하다 (App 초기화에서 가장 먼저 기다림).
 */
export function isReleaseBuild(): boolean {
  return !isDebugBuild();
}

/** 배포 앱에서는 숨긴 기능의 설정값을 고정: 외부 전송(Gemini·디스코드) 끔, PC 보호·자동 로그인·아이디 저장 켬 */
export function applyReleasePolicy(cfg: UserConfig): UserConfig {
  if (!isReleaseBuild()) return cfg;
  return {
    ...cfg,
    geminiApiKey: '',
    useGeminiSummary: false,
    discordWebhookUrl: '',
    protectPcSession: true,
    autoLogin: true,
    rememberId: true,
  };
}
