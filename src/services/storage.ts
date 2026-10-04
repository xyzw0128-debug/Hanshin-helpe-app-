import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { UserConfig, AppStateData } from '../types';

const CONFIG_KEY = 'hs_lms_config';
const STATE_KEY = 'hs_lms_state';

// 하드웨어 보안 스토리지(Android KeyStore / iOS Keychain) 전용 키
const SEC_KEY_PW = 'sec_user_pw';
const SEC_KEY_GEMINI = 'sec_gemini_api_key';
const SEC_KEY_DISCORD = 'sec_discord_webhook_url';

export const DEFAULT_CONFIG: UserConfig = {
  userId: '',
  userPw: '',
  geminiApiKey: '',
  discordWebhookUrl: '',
  pushNotificationsEnabled: true,
  ddayReminderEnabled: true,
  threeHourReminderEnabled: true,
  syncIntervalMinutes: 30,
  autoLogin: true,
  rememberId: true,
  useGeminiSummary: true,
  backgroundSyncEnabled: true,
  newAssignmentAlert: true,
  newNoticeAlert: true,
  themeMode: 'system',
  hideGrades: true,
};

export const DEFAULT_STATE: AppStateData = {
  lastSyncTime: null,
  courses: [],
  assignments: [],
  lectures: [],
  notices: [],
  seenItemKeys: [],
  sentReminders: {},
};

export async function loadConfig(): Promise<UserConfig> {
  try {
    const { value } = await Preferences.get({ key: CONFIG_KEY });
    const raw: UserConfig = value ? { ...DEFAULT_CONFIG, ...JSON.parse(value) } : { ...DEFAULT_CONFIG };

    // 1. Android KeyStore 기반 하드웨어 보안 스토리지에서 민감 정보 병렬 로드
    let userPw = '';
    let geminiApiKey = '';
    let discordWebhookUrl = '';

    try {
      const [pwData, geminiData, discordData] = await Promise.all([
        SecureStorage.get(SEC_KEY_PW),
        SecureStorage.get(SEC_KEY_GEMINI),
        SecureStorage.get(SEC_KEY_DISCORD),
      ]);
      if (typeof pwData === 'string') userPw = pwData;
      if (typeof geminiData === 'string') geminiApiKey = geminiData;
      if (typeof discordData === 'string') discordWebhookUrl = discordData;
    } catch (e) {
      console.warn('SecureStorage read exception', e);
    }

    // 2. 레거시 마이그레이션: 만약 SecureStorage에 없고 이전 Preferences에 남아있던 경우 이관
    let needReSave = false;
    if (!userPw && raw.userPw) {
      userPw = raw.userPw.startsWith('enc:') ? '' : raw.userPw;
      if (userPw) {
        await SecureStorage.set(SEC_KEY_PW, userPw);
      }
      needReSave = true;
    }
    if (!geminiApiKey && raw.geminiApiKey) {
      geminiApiKey = raw.geminiApiKey.startsWith('enc:') ? '' : raw.geminiApiKey;
      if (geminiApiKey) {
        await SecureStorage.set(SEC_KEY_GEMINI, geminiApiKey);
      }
      needReSave = true;
    }
    if (!discordWebhookUrl && raw.discordWebhookUrl) {
      discordWebhookUrl = raw.discordWebhookUrl.startsWith('enc:') ? '' : raw.discordWebhookUrl;
      if (discordWebhookUrl) {
        await SecureStorage.set(SEC_KEY_DISCORD, discordWebhookUrl);
      }
      needReSave = true;
    }

    if (needReSave) {
      await Preferences.set({
        key: CONFIG_KEY,
        value: JSON.stringify({
          ...raw,
          userPw: '',
          geminiApiKey: '',
          discordWebhookUrl: '',
        }),
      });
    }

    // SharedPreferences(CapacitorStorage.xml)에는 민감 데이터가 절대 저장되지 않음
    return {
      ...raw,
      userPw: userPw || '',
      geminiApiKey: geminiApiKey || '',
      discordWebhookUrl: discordWebhookUrl || '',
    };
  } catch (e) {
    console.error('Failed to load config', e);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: UserConfig): Promise<void> {
  try {
    // 1. 비밀번호, API 키, Discord Webhook은 Android KeyStore 하드웨어 보안 스토리지에 병렬 격리 저장
    // autoLogin이 false인 경우 보안 스토리지에서 비밀번호 삭제 (자동 로그인 해제)
    const shouldSavePw = config.autoLogin !== false && !!config.userPw;
    await Promise.all([
      shouldSavePw ? SecureStorage.set(SEC_KEY_PW, config.userPw) : SecureStorage.remove(SEC_KEY_PW),
      config.geminiApiKey ? SecureStorage.set(SEC_KEY_GEMINI, config.geminiApiKey) : SecureStorage.remove(SEC_KEY_GEMINI),
      config.discordWebhookUrl ? SecureStorage.set(SEC_KEY_DISCORD, config.discordWebhookUrl) : SecureStorage.remove(SEC_KEY_DISCORD),
    ]);

    // 2. 일반 SharedPreferences에는 비민감 설정만 저장 (민감 정보는 빈 문자열로 안전하게 처리)
    // rememberId가 false인 경우 아이디도 저장하지 않음 (단, 자동 로그인 사용 시 비밀번호만 남는 상태 방지를 위해 아이디 유지)
    const keepUserId = config.rememberId !== false || shouldSavePw;
    const sanitizedConfig: UserConfig = {
      ...config,
      userId: keepUserId ? config.userId : '',
      userPw: '',
      geminiApiKey: '',
      discordWebhookUrl: '',
    };

    await Preferences.set({
      key: CONFIG_KEY,
      value: JSON.stringify(sanitizedConfig),
    });
  } catch (e: any) {
    console.error('Failed to securely save config via KeyStore', e);
    throw new Error('보안 스토리지(KeyStore)에 계정 정보를 저장하는 중 오류가 발생했습니다: ' + (e.message || String(e)));
  }
}

export async function clearSecureStorage(): Promise<void> {
  try {
    await Promise.all([
      SecureStorage.remove(SEC_KEY_PW),
      SecureStorage.remove(SEC_KEY_GEMINI),
      SecureStorage.remove(SEC_KEY_DISCORD),
    ]);
  } catch (e) {
    console.warn('Failed to clear secure storage', e);
  }
}

export async function loadAppState(): Promise<AppStateData> {
  try {
    const { value } = await Preferences.get({ key: STATE_KEY });
    if (!value) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(value) };
  } catch (e) {
    console.error('Failed to load app state', e);
    return DEFAULT_STATE;
  }
}

export async function saveAppState(state: AppStateData): Promise<void> {
  await Preferences.set({
    key: STATE_KEY,
    value: JSON.stringify(state),
  });
}
