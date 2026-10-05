import React from 'react';
import { LectureItem } from '../types';
import { Check, Flame } from 'lucide-react';
import { LmsScraperService, parseLectureDeadline, stripLectureProgress } from '../services/lmsScraper';
import { formatDeadlineDateTime } from '../utils/date';

interface LectureCardProps {
  item: LectureItem;
}

const LectureCardInner: React.FC<LectureCardProps> = ({ item }) => {
  const done = item.isAttended;
  const deadlineMs = parseLectureDeadline(item.periodStr);
  const hasDeadline = Number.isFinite(deadlineMs);
  // 과제와 같은 D-day 규칙. 동기화 시점이 아니라 지금 시각 기준으로 계산
  const dday = !done && hasDeadline ? LmsScraperService.calculateDDay(item.periodStr, false) : null;
  const expired = !!dday && deadlineMs <= Date.now();
  const isUrgent = dday?.badgeType === 'urgent';
  const isWarning = dday?.badgeType === 'warning';
  const muted = done || expired;

  const badgeText = done ? '완료' : dday ? dday.badgeText : '기한 없음';
  const badgeClass = isUrgent
    ? 'bg-red-600 text-white'
    : isWarning
    ? 'bg-amber-500 text-white'
    : muted
    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
    : 'bg-zinc-800 text-zinc-200';

  const borderClass = isUrgent
    ? 'border-2 border-red-500/40'
    : muted
    ? 'border border-zinc-200/60 dark:border-zinc-800/60 opacity-80'
    : 'border border-zinc-200 dark:border-zinc-800';

  const status = done
    ? { text: '출석 인정', className: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60' }
    : item.progressPercent > 0
    ? { text: '진행 중', className: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60' }
    : { text: '미수강', className: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60' };

  const barClass = done ? 'bg-emerald-500' : isUrgent ? 'bg-red-500' : 'bg-hs-600 dark:bg-hs-400';
  const percentClass = done
    ? 'text-emerald-600'
    : isUrgent
    ? 'text-red-600 dark:text-red-400'
    : 'text-zinc-700 dark:text-zinc-300';

  return (
    <div className={`bg-white dark:bg-zinc-900 ${borderClass} p-4 rounded-2xl shadow-sm space-y-2.5`}>
      <div className="flex items-center justify-between">
        <span className={`px-2.5 py-1 text-xs font-black rounded-lg ${badgeClass} shadow-sm flex items-center gap-1`}>
          {isUrgent && <Flame className="w-3 h-3" />}
          {badgeText}
        </span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${status.className}`}>
          {done && <Check className="w-3.5 h-3.5" />}
          {status.text}
        </span>
      </div>

      <div>
        <span className="text-xs text-hs-700 dark:text-hs-300 font-semibold">{item.courseNm}</span>
        <h4 className="text-sm font-bold text-zinc-900 dark:text-white leading-snug mt-0.5">
          {stripLectureProgress(item.title)}
        </h4>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>학습 진도</span>
          <span className={`font-bold ${percentClass}`}>{item.progressPercent}%</span>
        </div>
        <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full ${barClass} rounded-full`} style={{ width: `${item.progressPercent}%` }} />
        </div>
      </div>

      <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <span className="truncate">
          {hasDeadline ? `${formatDeadlineDateTime(deadlineMs)} 종료` : item.periodStr || '종료시한 정보 없음'}
        </span>
        {dday && !expired && (
          <b className={`flex-shrink-0 ${isUrgent ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
            {dday.timeLeftText}
          </b>
        )}
      </div>
    </div>
  );
};

export const LectureCard = React.memo(LectureCardInner);
