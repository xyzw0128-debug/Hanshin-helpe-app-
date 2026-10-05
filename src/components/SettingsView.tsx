import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { UserConfig } from '../types';
import { NotificationService, isValidDiscordWebhookUrl } from '../services/notifications';
import { getBackgroundSyncStatus, BackgroundSyncStatus } from '../services/backgroundSync';
import { isDebugBuild } from '../services/debugLog';
import { isReleaseBuild } from '../services/buildPolicy';
import { Toggle } from './Toggle';
import {
  getSystemStatus,
  openBatterySettings,
  openExactAlarmSettings,
  openNotificationSettings,
  SystemStatus,
} from '../services/appShell';

/** 알림이 늦거나 안 오는 원인 한 줄: 괜찮으면 체크, 아니면 설정 열기 버튼 */
const CheckRow: React.FC<{ title: string; ok: boolean; okText: string; badText: string; action: string; onFix: () => void }> = ({
  title,
  ok,
  okText,
  badText,
  action,
  onFix,
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3">
    <div className="min-w-0 flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{ok ? okText : badText}</div>
      </div>
    </div>
    {!ok && (
      <button onClick={onFix} className={smallButtonClass}>
        {action}
      </button>
    )}
  </div>
);

interface SettingsViewProps {
  config: UserConfig;
  /** 토글·선택 항목은 바뀌는 즉시 저장 */
  onUpdate: (patch: Partial<UserConfig>) => Promise<void>;
  /** 아이디·비밀번호 변경은 LMS 로그인 확인 후 저장 (성공 여부 반환) */
  onChangeAccount: (userId: string, userPw: string) => Promise<boolean>;
  onOpenHomeEdit: () => void;
}

const sectionClass =
  'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800';
const inputClass =
  'w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none';
const smallButtonClass =
  'px-3 py-2 text-xs font-bold rounded-xl bg-hs-700 dark:bg-hs-500 text-white disabled:opacity-40 whitespace-nowrap';

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[11px] font-black text-zinc-400 dark:text-zinc-500 px-1 pt-1">{children}</h3>
);

const ToggleRow: React.FC<{
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ title, description, checked, onChange, disabled }) => (
  <div className={`flex items-center justify-between gap-3 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
    <div className="min-w-0">
      <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</div>
      {description && <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</div>}
    </div>
    <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
  </div>
);

const SecretInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  value,
  onChange,
  placeholder,
}) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative flex-1">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`${inputClass} pr-9`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-400"
        aria-label={show ? '숨기기' : '보기'}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({ config, onUpdate, onChangeAccount, onOpenHomeEdit }) => {
  const release = isReleaseBuild();
  const [bgStatus, setBgStatus] = useState<BackgroundSyncStatus | null>(null);
  const refreshBgStatus = () => getBackgroundSyncStatus().then(setBgStatus);
  useEffect(() => {
    refreshBgStatus();
  }, [config.backgroundSyncEnabled, config.syncIntervalMinutes, config.pushNotificationsEnabled]);

  // 알림 점검 (앱에서만). 설정 화면에 다녀오면 다시 확인
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const recheckTimer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    const refresh = () => getSystemStatus().then(setSysStatus);
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(recheckTimer.current);
    };
  }, []);
  // 배터리 최적화 허용 같은 확인 창은 앱 위에 겹쳐 떠서 화면 복귀 신호가 없음 → 누른 뒤 30초 동안 다시 확인
  const fixAndRecheck = (open: () => Promise<unknown>) => {
    open();
    clearInterval(recheckTimer.current);
    let n = 0;
    recheckTimer.current = setInterval(() => {
      getSystemStatus().then(setSysStatus);
      if (++n >= 20) clearInterval(recheckTimer.current);
    }, 1500);
  };

  // 입력값(계정·키)은 저장 버튼을 눌러야 반영
  const [userId, setUserId] = useState(config.userId);
  const [userPw, setUserPw] = useState(config.userPw);
  const [accountBusy, setAccountBusy] = useState(false);
  const [geminiKey, setGeminiKey] = useState(config.geminiApiKey);
  const [webhookUrl, setWebhookUrl] = useState(config.discordWebhookUrl);
  const [webhookResult, setWebhookResult] = useState<string | null>(null);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);

  const pushOn = config.pushNotificationsEnabled !== false;
  const bgOn = config.backgroundSyncEnabled !== false;
  const autoLoginOn = config.autoLogin !== false;
  const themeMode = config.themeMode || 'system';
  const accountChanged = userId.trim() !== config.userId || userPw !== config.userPw;

  const handleTestWebhook = async () => {
    const cleanUrl = (webhookUrl || '').trim();
    if (!isValidDiscordWebhookUrl(cleanUrl)) {
      setWebhookResult('올바른 디스코드 웹훅 주소(https://discord.com/api/webhooks/...)를 입력해주세요.');
      return;
    }
    setIsTestingWebhook(true);
    setWebhookResult(null);
    try {
      const ok = await NotificationService.sendDiscordWebhook(
        cleanUrl,
        '🧪 **[한신대 LMS]** 디스코드 웹훅 연결 테스트 성공! 정상적으로 알림을 수신할 수 있습니다.'
      );
      setWebhookResult(ok ? '테스트 메시지를 보냈습니다.' : '전송에 실패했습니다. 채널 권한 또는 URL을 확인해주세요.');
    } catch {
      setWebhookResult('네트워크 오류로 전송에 실패했습니다.');
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const bgStatusText = !bgOn || !pushOn ? '꺼짐' : bgStatus?.lastStatus || '대기 중';

  return (
    <div className="space-y-2.5 pb-10">
      <SectionTitle>알림</SectionTitle>
      <div className={sectionClass}>
        <ToggleRow
          title="푸시 알림"
          description="휴대폰 상단바 알림 전체"
          checked={pushOn}
          onChange={v => onUpdate({ pushNotificationsEnabled: v })}
        />
        <ToggleRow
          title="새 과제·강의·퀴즈 알림"
          description={release ? '새로 올라온 과제·온라인 강의·퀴즈' : '새로 올라온 과제·온라인 강의·퀴즈 (디스코드 웹훅에도 적용)'}
          checked={config.newAssignmentAlert !== false}
          onChange={v => onUpdate({ newAssignmentAlert: v })}
        />
        <ToggleRow
          title="새 공지 알림"
          description={release ? '과목 공지와 LMS 전체 공지' : '과목 공지와 LMS 전체 공지 (디스코드 웹훅에도 적용)'}
          checked={config.newNoticeAlert !== false}
          onChange={v => onUpdate({ newNoticeAlert: v })}
        />
        <ToggleRow
          title="마감 하루 전 알림"
          description="미제출 과제·퀴즈, 미수강 온라인 강의 마감 24시간 전"
          checked={config.ddayReminderEnabled !== false}
          onChange={v => onUpdate({ ddayReminderEnabled: v })}
          disabled={!pushOn}
        />
        <ToggleRow
          title="마감 3시간 전 알림"
          description="화면이 꺼져 있어도 울려요"
          checked={config.threeHourReminderEnabled !== false}
          onChange={v => onUpdate({ threeHourReminderEnabled: v })}
          disabled={!pushOn}
        />
      </div>

      <SectionTitle>백그라운드 동기화</SectionTitle>
      <div className={sectionClass}>
        <ToggleRow
          title="앱이 꺼져 있을 때도 확인"
          description="새 과제·강의·퀴즈와 과목 공지를 주기적으로 확인하고, 제출을 마친 과제의 마감 알림은 지워요 (푸시 알림이 켜져 있을 때만)"
          checked={bgOn}
          onChange={v => onUpdate({ backgroundSyncEnabled: v })}
          disabled={!pushOn}
        />
        <div className={`flex items-center justify-between gap-3 px-4 py-3 ${!bgOn || !pushOn ? 'opacity-50' : ''}`}>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">확인 주기</span>
          <select
            value={config.syncIntervalMinutes || 30}
            onChange={e => onUpdate({ syncIntervalMinutes: Number(e.target.value) })}
            disabled={!bgOn || !pushOn}
            className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white font-medium"
          >
            {isDebugBuild() && <option value={1}>1분 (디버그 테스트)</option>}
            <option value={15}>15분</option>
            <option value={30}>30분</option>
            <option value={60}>1시간</option>
            <option value={120}>2시간</option>
          </select>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500 flex items-center gap-1">
              최근 상태
              <button onClick={refreshBgStatus} className="p-0.5 text-zinc-400" aria-label="상태 새로고침">
                <RefreshCw className="w-3 h-3" />
              </button>
            </span>
            <span className="font-bold text-zinc-700 dark:text-zinc-300">{bgStatusText}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">마지막 실행</span>
            <span className="text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">{bgStatus?.lastSyncTime || '-'}</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed pt-1">
            PC에서 LMS를 쓰는 중에 로그아웃되지 않도록, 백그라운드에서는 세션이 만료되면 다시 로그인하지 않고 건너뜁니다.
          </p>
        </div>
      </div>

      {sysStatus && pushOn && (
        <>
          <SectionTitle>알림이 늦거나 안 올 때</SectionTitle>
          <div className={sectionClass}>
            <CheckRow
              title="알림 권한"
              ok={sysStatus.notificationsEnabled}
              okText="허용됨"
              badText="휴대폰 설정에서 이 앱의 알림이 꺼져 있어요"
              action="켜기"
              onFix={() => fixAndRecheck(openNotificationSettings)}
            />
            <CheckRow
              title="배터리 최적화 제외"
              ok={sysStatus.ignoringBatteryOptimizations}
              okText="제외됨: 앱이 꺼져 있어도 확인이 멈추지 않아요"
              badText={
                /samsung/i.test(sysStatus.manufacturer)
                  ? "절전 기능이 백그라운드 확인을 멈출 수 있어요. 삼성은 '잠자는 앱'에서도 빼 주세요"
                  : '절전 기능이 백그라운드 확인을 멈출 수 있어요'
              }
              action="제외하기"
              onFix={() => fixAndRecheck(openBatterySettings)}
            />
            <CheckRow
              title="정확한 시간에 알림"
              ok={sysStatus.exactAlarmsAllowed}
              okText="마감 알림이 제시간에 울려요"
              badText="마감 알림이 몇 분 늦을 수 있어요"
              action="허용하기"
              onFix={() => fixAndRecheck(openExactAlarmSettings)}
            />
          </div>
        </>
      )}

      <SectionTitle>화면</SectionTitle>
      <div className={sectionClass}>
        <button onClick={onOpenHomeEdit} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">홈 화면 편집</span>
          <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
        </button>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">테마</span>
          <div className="flex p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-bold">
            {(
              [
                ['system', '시스템'],
                ['light', '라이트'],
                ['dark', '다크'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => onUpdate({ themeMode: mode })}
                className={`px-2.5 py-1 rounded-md ${
                  themeMode === mode ? 'bg-white dark:bg-zinc-700 text-hs-700 dark:text-hs-300 shadow-sm' : 'text-zinc-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ToggleRow
          title="성적 가리기"
          description="성적 화면에서 눌러야 평점이 보이도록"
          checked={config.hideGrades !== false}
          onChange={v => onUpdate({ hideGrades: v })}
        />
      </div>

      {/* 계정·연동 섹션은 디버그 빌드에서만 (배포 앱: 계정 변경은 로그아웃 후 다시 로그인, 외부 연동 없음) */}
      {!release && (
        <>
      <SectionTitle>계정</SectionTitle>
      <div className={sectionClass}>
        <div className="px-4 py-3 space-y-2">
          <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="포털 아이디" className={inputClass} />
          <div className="flex gap-2">
            <SecretInput value={userPw} onChange={setUserPw} placeholder="비밀번호" />
            <button
              disabled={!accountChanged || accountBusy || !userId.trim() || !userPw}
              onClick={async () => {
                setAccountBusy(true);
                const ok = await onChangeAccount(userId.trim(), userPw);
                if (!ok) {
                  setUserId(config.userId);
                  setUserPw(config.userPw);
                }
                setAccountBusy(false);
              }}
              className={smallButtonClass}
            >
              {accountBusy ? '확인 중' : '변경'}
            </button>
          </div>
          <p className="text-[11px] text-zinc-400">변경 시 LMS 로그인으로 계정을 확인한 뒤 저장합니다.</p>
        </div>
        <ToggleRow
          title="자동 로그인"
          description="끄면 앱을 다시 열 때 비밀번호를 입력해야 합니다"
          checked={autoLoginOn}
          onChange={v => onUpdate({ autoLogin: v, ...(v ? { rememberId: true } : {}) })}
        />
        <ToggleRow
          title="아이디 저장"
          description={autoLoginOn ? '자동 로그인 사용 중에는 항상 저장됩니다' : undefined}
          checked={autoLoginOn || config.rememberId !== false}
          onChange={v => onUpdate({ rememberId: v })}
          disabled={autoLoginOn}
        />
        <ToggleRow
          title="PC 로그인 보호"
          description="다른 곳에서 LMS에 로그인한 것 같으면 다시 로그인하지 않고 자동 동기화를 멈춤"
          checked={config.protectPcSession !== false}
          onChange={v => onUpdate({ protectPcSession: v })}
        />
      </div>

      <SectionTitle>연동</SectionTitle>
      <div className={sectionClass}>
        <ToggleRow
          title="Gemini AI 공지 요약"
          description="공지 본문을 3줄로 요약 (공지 제목·본문이 Google Gemini로 전송됩니다)"
          checked={config.useGeminiSummary !== false}
          onChange={v => onUpdate({ useGeminiSummary: v })}
        />
        {config.useGeminiSummary !== false && (
          <div className="px-4 py-3 flex gap-2">
            <SecretInput value={geminiKey} onChange={setGeminiKey} placeholder="Gemini API 키 (비우면 기본 요약)" />
            <button
              disabled={geminiKey.trim() === (config.geminiApiKey || '')}
              onClick={() => onUpdate({ geminiApiKey: geminiKey.trim() })}
              className={smallButtonClass}
            >
              저장
            </button>
          </div>
        )}
        <div className="px-4 py-3 space-y-2">
          <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">디스코드 웹훅</div>
          <div className="flex gap-2">
            <SecretInput
              value={webhookUrl}
              onChange={v => {
                setWebhookUrl(v);
                setWebhookResult(null);
              }}
              placeholder="https://discord.com/api/webhooks/..."
            />
            <button
              disabled={webhookUrl.trim() === (config.discordWebhookUrl || '')}
              onClick={() => onUpdate({ discordWebhookUrl: webhookUrl.trim() })}
              className={smallButtonClass}
            >
              저장
            </button>
          </div>
          {webhookUrl.trim() && (
            <button
              onClick={handleTestWebhook}
              disabled={isTestingWebhook}
              className="text-xs font-bold text-hs-700 dark:text-hs-200 bg-hs-50 dark:bg-hs-900 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {isTestingWebhook ? '전송 중' : '연결 테스트'}
            </button>
          )}
          {webhookResult && <p className="text-xs text-zinc-600 dark:text-zinc-300">{webhookResult}</p>}
          <p className="text-[11px] text-zinc-400">웹훅 주소가 유출되면 다른 사람이 채널에 메시지를 올릴 수 있으니 주의하세요.</p>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
