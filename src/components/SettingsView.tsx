import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ClipboardCopy, RefreshCw, Share2, Trash2, FileText } from 'lucide-react';
import { UserConfig } from '../types';
import { NotificationService, isValidDiscordWebhookUrl } from '../services/notifications';
import { getLaunchLogs, clearLaunchLogs } from '../utils/campusLauncher';
import { getBackgroundSyncStatus, BackgroundSyncStatus } from '../services/backgroundSync';
import { isDebugLogEnabled, getCombinedDebugLog, shareDebugLog, clearDebugLogs } from '../services/debugLog';

interface SettingsViewProps {
  config: UserConfig;
  onSaveConfig: (updated: UserConfig) => void;
  onLogout: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, onSaveConfig, onLogout }) => {
  const [userId, setUserId] = useState(config.userId);
  const [userPw, setUserPw] = useState(config.userPw);
  const [geminiApiKey, setGeminiApiKey] = useState(config.geminiApiKey);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(config.discordWebhookUrl);
  const [pushEnabled, setPushEnabled] = useState(config.pushNotificationsEnabled);
  const [ddayReminder, setDdayReminder] = useState(config.ddayReminderEnabled);
  const [threeHourReminder, setThreeHourReminder] = useState(config.threeHourReminderEnabled);
  const [syncInterval, setSyncInterval] = useState(config.syncIntervalMinutes || 30);
  const [useGeminiSummary, setUseGeminiSummary] = useState(config.useGeminiSummary !== false);
  const [bgSyncEnabled, setBgSyncEnabled] = useState(config.backgroundSyncEnabled !== false);
  const [bgStatus, setBgStatus] = useState<BackgroundSyncStatus | null>(null);
  const debugEnabled = isDebugLogEnabled();
  const [debugLogText, setDebugLogText] = useState<string | null>(null);

  const refreshDebugLog = async () => setDebugLogText(await getCombinedDebugLog());

  useEffect(() => {
    getBackgroundSyncStatus().then(status => {
      setBgStatus(status);
    });
  }, []);

  const [showPw, setShowPw] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showDiscord, setShowDiscord] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTestWebhook = async () => {
    const cleanUrl = (discordWebhookUrl || '').trim();
    if (!isValidDiscordWebhookUrl(cleanUrl)) {
      setTestResult('⚠️ 올바른 디스코드 웹훅 주소(https://discord.com/api/webhooks/...)를 입력해주세요.');
      return;
    }
    setIsTestingWebhook(true);
    setTestResult(null);
    try {
      const ok = await NotificationService.sendDiscordWebhook(
        cleanUrl,
        '🧪 **[한신대 LMS]** 디스코드 웹훅 연결 테스트 성공! 정상적으로 알림을 수신할 수 있습니다.'
      );
      if (ok) {
        setTestResult('✅ 디스코드 채널로 테스트 메시지가 성공적으로 전송되었습니다!');
      } else {
        setTestResult('❌ 웹훅 전송에 실패했습니다. 채널 권한 또는 URL을 확인해주세요.');
      }
    } catch {
      setTestResult('❌ 네트워크 오류로 웹훅 전송에 실패했습니다.');
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleSave = () => {
    onSaveConfig({
      ...config,
      userId,
      userPw,
      geminiApiKey,
      discordWebhookUrl,
      pushNotificationsEnabled: pushEnabled,
      ddayReminderEnabled: ddayReminder,
      threeHourReminderEnabled: threeHourReminder,
      syncIntervalMinutes: syncInterval,
      useGeminiSummary,
      backgroundSyncEnabled: bgSyncEnabled,
    });
    setTimeout(() => {
      getBackgroundSyncStatus().then(status => setBgStatus(status));
    }, 200);
  };

  return (
    <div className="space-y-4 pb-10">
      <h3 className="text-xs font-black text-zinc-900 dark:text-white px-1">계정 및 알림 환경설정</h3>

      {/* 계정 설정 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">한신대 포털 로그인 계정</h4>
          <span className="text-xs text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
            인증됨
          </span>
        </div>
        <div className="space-y-2.5">
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1">아이디 (ID)</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1">비밀번호 (PW)</label>
            <div className="relative flex items-center">
              <input
                type={showPw ? 'text' : 'password'}
                value={userPw}
                onChange={e => setUserPw(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
              />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-1 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 푸시 알림 설정 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm space-y-3">
        <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">푸시 알림 설정</h4>

        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 block">스마트폰 상단바 알림</span>
            <span className="text-xs text-zinc-500">새 과제/공지 발견 시 푸시 알림</span>
          </div>
          <input
            type="checkbox"
            checked={pushEnabled}
            onChange={e => setPushEnabled(e.target.checked)}
            className="w-4 h-4 accent-hs-700 dark:accent-hs-400"
          />
        </div>

        <div className="flex items-center justify-between text-xs border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
          <div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 block">마감 당일 낮 12시 리마인더</span>
            <span className="text-xs text-zinc-500">오늘 마감 과제 점심시간 알림</span>
          </div>
          <input
            type="checkbox"
            checked={ddayReminder}
            onChange={e => setDdayReminder(e.target.checked)}
            className="w-4 h-4 accent-hs-700 dark:accent-hs-400"
          />
        </div>

        <div className="flex items-center justify-between text-xs border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
          <div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 block">마감 3시간 전 긴급 리마인더</span>
            <span className="text-xs text-zinc-500">미제출 과제 마감 직전 경고</span>
          </div>
          <input
            type="checkbox"
            checked={threeHourReminder}
            onChange={e => setThreeHourReminder(e.target.checked)}
            className="w-4 h-4 accent-hs-700 dark:accent-hs-400"
          />
        </div>
      </div>

      {/* 백그라운드 자동 동기화 (WorkManager) */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">백그라운드 자동 동기화</h4>
            <span className="text-[10px] font-bold text-hs-700 dark:text-hs-300 bg-hs-50 dark:bg-hs-950 px-2 py-0.5 rounded-md border border-hs-200/50 dark:border-hs-800/50">
              WorkManager
            </span>
          </div>
          <input
            type="checkbox"
            checked={bgSyncEnabled}
            onChange={e => setBgSyncEnabled(e.target.checked)}
            className="w-4 h-4 accent-hs-700 dark:accent-hs-400 cursor-pointer"
          />
        </div>

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          앱이 꺼져 있어도 백그라운드에서 주기적으로 미완료 과제 및 인강을 확인합니다.
        </p>

        {/* 마지막 실행 상태 배지 */}
        <div className="bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-100 dark:border-zinc-800/80 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500 font-medium">동기화 상태</span>
              <button
                type="button"
                onClick={async () => {
                  const s = await getBackgroundSyncStatus();
                  setBgStatus(s);
                }}
                title="상태 새로고침"
                className="p-0.5 text-zinc-400 hover:text-hs-700 dark:hover:text-hs-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              !bgSyncEnabled
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                : (bgStatus?.lastStatus?.includes('정상') || bgStatus?.lastStatus?.includes('성공'))
                ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/50'
                : bgStatus?.lastStatus?.includes('세션 만료')
                ? 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
            }`}>
              {bgSyncEnabled ? (bgStatus?.lastStatus || '동기화 대기 중') : '동기화 꺼짐'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1.5 border-t border-zinc-200/40 dark:border-zinc-800/40">
            <span className="text-zinc-500 font-medium">마지막 실행</span>
            <span className="text-zinc-700 dark:text-zinc-300 font-mono text-[11px]">
              {bgStatus?.lastSyncTime || '동기화 이력 없음'}
            </span>
          </div>
        </div>

        {/* 동기화 주기 설정 */}
        {bgSyncEnabled && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-zinc-500">동기화 확인 주기</label>
              <span className="text-[10px] text-zinc-400">최소 15분, 시스템 권장 30분</span>
            </div>
            <select
              value={syncInterval}
              onChange={e => setSyncInterval(Number(e.target.value))}
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white font-medium"
            >
              <option value={15}>15분마다 자동 확인 (OS 최소 주기)</option>
              <option value={30}>30분마다 자동 확인 (시스템 권장)</option>
              <option value={60}>1시간마다 자동 확인</option>
            </select>
          </div>
        )}

        {/* PC 세션 보호 안내 노트 */}
        <div className="p-2.5 bg-zinc-100/70 dark:bg-zinc-800/40 rounded-xl text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          ℹ️ <strong>PC 세션 보호:</strong> PC에서 LMS 학습 중 모바일 백그라운드 동기화로 인해 세션이 끊어지지 않도록, 백그라운드에서는 세션 만료 시 재로그인하지 않고 무음 종료됩니다. (앱 실행 시 자동 재로그인)
        </div>
      </div>

      {/* AI 및 디스코드 연동 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm space-y-3.5">
        <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">연동 API 설정 (선택)</h4>

        {/* Gemini AI 요약 On / Off 토글 */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 block">Gemini AI 요약 활성화</span>
            <span className="text-xs text-zinc-500">공지사항 본문을 3줄 핵심 요약으로 자동 변환</span>
          </div>
          <input
            type="checkbox"
            checked={useGeminiSummary}
            onChange={e => setUseGeminiSummary(e.target.checked)}
            className="w-4 h-4 accent-hs-700 dark:accent-hs-400 cursor-pointer"
          />
        </div>

        {useGeminiSummary && (
          <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <div>
              <label className="text-xs font-semibold text-zinc-500 block mb-1">Gemini API 키</label>
              <div className="relative flex items-center">
                <input
                  type={showGemini ? 'text' : 'password'}
                  placeholder="AI Studio API 키 입력 (비워두면 로컬 기본 요약 사용)"
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowGemini(!showGemini)}
                  className="absolute right-1 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  {showGemini ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* 프라이버시 안내 문구 */}
            <div className="p-2.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-xl text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              ℹ️ <strong>데이터 안내:</strong> AI 요약 기능 동작 시 공지사항 제목 및 본문 텍스트가 Google Gemini 서버로 전달됩니다. 포털 학번이나 비밀번호 등 개인 식별 정보는 일절 전송되지 않습니다.
            </div>
          </div>
        )}

        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2.5">
          <label className="text-xs font-semibold text-zinc-500 block mb-1">디스코드 웹훅 URL</label>
          <div className="relative flex items-center">
            <input
              type={showDiscord ? 'text' : 'password'}
              placeholder="https://discord.com/api/webhooks/..."
              value={discordWebhookUrl}
              onChange={e => {
                setDiscordWebhookUrl(e.target.value);
                setTestResult(null);
              }}
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
            />
                <button
                  type="button"
                  onClick={() => setShowDiscord(!showDiscord)}
                  className="absolute right-1 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
              {showDiscord ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            ※ https://discord.com/api/webhooks/... 형식의 공식 웹훅 주소를 입력하세요. 웹훅 URL이 유출되면 다른 사람이 채널에 메시지를 올릴 수 있으니 주의하세요.
          </p>

          {discordWebhookUrl && (
            <div className="mt-2 flex items-center space-x-2">
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={isTestingWebhook}
                className="text-xs font-bold text-hs-700 dark:text-hs-200 bg-hs-50 dark:bg-hs-900 hover:bg-hs-100 dark:hover:bg-hs-800 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
              >
                {isTestingWebhook ? '전송 확인 중...' : '🔔 웹훅 연결 테스트'}
              </button>
            </div>
          )}

          {testResult && (
            <div className="mt-2 text-xs p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800/60 font-medium">
              {testResult}
            </div>
          )}
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="space-y-2">
        <button
          onClick={handleSave}
          className="w-full py-3 bg-hs-700 hover:bg-hs-800 active:scale-98 dark:bg-hs-500 dark:hover:bg-hs-600 text-white font-bold text-xs rounded-xl shadow-md transition-all"
        >
          설정 저장
        </button>
        <button
          onClick={onLogout}
          className="w-full py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-600 dark:text-zinc-400 font-semibold text-xs rounded-xl transition-all"
        >
          로그아웃 (계정 연결 해제)
        </button>
      </div>

      {/* 디버그 로그 (디버그 빌드 전용: 백그라운드 워커 / 세션 / 동기화 / 오류) */}
      {debugEnabled && (
        <div className="p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              디버그 로그
            </span>
            <span className="text-[10px] text-zinc-400">디버그 빌드 전용 · 비밀번호/쿠키는 마스킹</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => (debugLogText === null ? refreshDebugLog() : setDebugLogText(null))}
              className="py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
            >
              <FileText className="w-3.5 h-3.5" />
              {debugLogText === null ? '보기' : '닫기'}
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await shareDebugLog();
                  if (result === 'copied') alert('공유를 지원하지 않아 로그를 클립보드에 복사했습니다.');
                } catch (e: any) {
                  alert('로그 공유 실패: ' + (e?.message || String(e)));
                }
              }}
              className="py-2 bg-hs-50 dark:bg-hs-950/50 hover:bg-hs-100 dark:hover:bg-hs-900/60 text-hs-700 dark:text-hs-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
            >
              <Share2 className="w-3.5 h-3.5" />
              공유
            </button>
            <button
              onClick={async () => {
                if (!confirm('수집된 디버그 로그를 모두 지울까요?')) return;
                await clearDebugLogs();
                if (debugLogText !== null) await refreshDebugLog();
              }}
              className="py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-zinc-600 dark:text-zinc-400 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              지우기
            </button>
          </div>
          {debugLogText !== null && (
            <div className="space-y-1">
              <button
                onClick={refreshDebugLog}
                className="text-[10px] font-bold text-hs-700 dark:text-hs-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> 새로고침
              </button>
              <pre className="max-h-72 overflow-auto p-2 bg-zinc-900 text-zinc-100 rounded-lg text-[9px] leading-snug whitespace-pre-wrap break-all">
                {debugLogText}
              </pre>
            </div>
          )}
          <button
            onClick={async () => {
              const logs = getLaunchLogs();
              if (logs.length === 0) {
                alert('수집된 퀵허브 로그가 없습니다.\n퀵허브 버튼을 사용한 후 다시 시도해주세요.');
                return;
              }
              const text = JSON.stringify(logs, null, 2);
              try {
                await navigator.clipboard.writeText(text);
                alert(`퀵허브 로그 ${logs.length}건이 클립보드에 복사되었습니다.`);
              } catch {
                prompt('아래 로그를 복사하세요:', text);
              }
            }}
            className="w-full py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            캠퍼스 퀵허브 성능 로그 복사 ({getLaunchLogs().length}건)
          </button>
        </div>
      )}
    </div>
  );
};
