import React, { useState } from 'react';
import { ClipboardCopy, RefreshCw, Share2, Trash2, FileText } from 'lucide-react';
import pkg from '../../package.json';
import { getLaunchLogs } from '../utils/campusLauncher';
import {
  isDebugBuild,
  isDebugLogEnabled,
  setReportLogEnabled,
  getCombinedDebugLog,
  shareDebugLog,
  clearDebugLogs,
} from '../services/debugLog';
import { Toggle } from './Toggle';

/** 배포 앱에서 버전을 이만큼 연속으로 누르면 숨김 메뉴(문제 신고용 로그)가 열림 */
const REVEAL_TAPS = 7;

const Row: React.FC<{ label: string; value: string; onClick?: () => void }> = ({ label, value, onClick }) => (
  <div className="flex items-center justify-between px-4 py-3 select-none" onClick={onClick}>
    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
    <span className="text-sm text-zinc-500 dark:text-zinc-400">{value}</span>
  </div>
);

/** 로그 보기 · 공유 · 지우기 */
const LogTools: React.FC = () => {
  const [logText, setLogText] = useState<string | null>(null);
  const refresh = async () => setLogText(await getCombinedDebugLog());

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => (logText === null ? refresh() : setLogText(null))}
          className="py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
        >
          <FileText className="w-3.5 h-3.5" />
          {logText === null ? '보기' : '닫기'}
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
          className="py-2 bg-hs-50 dark:bg-hs-950/50 text-hs-700 dark:text-hs-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
        >
          <Share2 className="w-3.5 h-3.5" />
          공유
        </button>
        <button
          onClick={async () => {
            if (!confirm('수집된 로그를 모두 지울까요?')) return;
            await clearDebugLogs();
            if (logText !== null) await refresh();
          }}
          className="py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-semibold text-xs rounded-xl flex items-center justify-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          지우기
        </button>
      </div>
      {logText !== null && (
        <div className="space-y-1">
          <button onClick={refresh} className="text-[10px] font-bold text-hs-700 dark:text-hs-300 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> 새로고침
          </button>
          <pre className="max-h-96 overflow-auto p-2 bg-zinc-900 text-zinc-100 rounded-lg text-[9px] leading-snug whitespace-pre-wrap break-all">
            {logText}
          </pre>
        </div>
      )}
    </div>
  );
};

export const AppInfoView: React.FC = () => {
  const debugBuild = isDebugBuild();
  const [reportOn, setReportOn] = useState(isDebugLogEnabled());
  // 배포 앱: 로그를 켜 둔 상태면 바로 보이고, 아니면 버전을 7번 눌러야 보임
  const [revealed, setRevealed] = useState(isDebugLogEnabled());
  const [taps, setTaps] = useState(0);

  const onVersionTap = () => {
    if (debugBuild || revealed) return;
    const next = taps + 1;
    setTaps(next);
    if (next >= REVEAL_TAPS) setRevealed(true);
  };

  return (
    <div className="space-y-3.5">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
        <Row label="버전" value={pkg.version} onClick={onVersionTap} />
        <Row label="빌드" value={debugBuild ? '디버그' : '릴리스'} />
      </div>

      {/* 디버그 빌드: 개발용 로그 (항상 기록) */}
      {debugBuild && (
        <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-zinc-800 dark:text-zinc-200">디버그 로그</span>
            <span className="text-[10px] text-zinc-400">비밀번호·쿠키는 마스킹</span>
          </div>
          <LogTools />
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
            className="w-full py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5"
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            캠퍼스 퀵허브 성능 로그 복사 ({getLaunchLogs().length}건)
          </button>
        </div>
      )}

      {/* 배포 앱: 숨김 메뉴 "문제 신고용 로그" (기본 꺼짐) */}
      {!debugBuild && revealed && (
        <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">문제 신고용 로그</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                문제가 생겼을 때만 켜 주세요. 다시 겪은 뒤 공유로 보내 주시면 돼요. 비밀번호·쿠키는 가려져요.
              </div>
            </div>
            <Toggle
              checked={reportOn}
              label="문제 신고용 로그"
              onChange={async v => setReportOn(await setReportLogEnabled(v))}
            />
          </div>
          <LogTools />
        </div>
      )}
    </div>
  );
};
