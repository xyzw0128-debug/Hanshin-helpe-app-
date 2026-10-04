import React from 'react';
import { AssignmentItem } from '../types';
import { Flame } from 'lucide-react';

interface AssignmentCardProps {
  item: AssignmentItem;
  onClick: () => void;
}

const AssignmentCardInner: React.FC<AssignmentCardProps> = ({ item, onClick }) => {
  const isUrgent = item.badgeType === 'urgent';
  const isWarning = item.badgeType === 'warning';
  const isDone = item.badgeType === 'done';

  const badgeClass = isUrgent
    ? 'bg-red-600 text-white'
    : isWarning
    ? 'bg-amber-500 text-white'
    : isDone
    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
    : 'bg-zinc-800 text-zinc-200';

  const borderClass = isUrgent
    ? 'border-2 border-red-500/40'
    : isDone
    ? 'border-zinc-200/60 dark:border-zinc-800/60 opacity-80'
    : 'border-zinc-200 dark:border-zinc-800';

  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-zinc-900 ${borderClass} p-4 rounded-2xl shadow-sm space-y-2 cursor-pointer active:scale-[0.99] transition-transform`}
    >
      <div className="flex items-center justify-between">
        <span className={`px-2.5 py-1 text-xs font-black rounded-lg ${badgeClass} shadow-sm flex items-center gap-1`}>
          {isUrgent && <Flame className="w-3 h-3" />}
          {item.ddayBadgeText}
        </span>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-md ${
            item.isSubmitted
              ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60'
              : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60'
          }`}
        >
          {item.isSubmitted ? '제출완료' : '미제출'}
        </span>
      </div>

      <div>
        <span className="text-xs text-hs-700 dark:text-hs-300 font-semibold">{item.courseNm}</span>
        <h4 className="text-sm font-bold text-zinc-900 dark:text-white leading-snug mt-0.5">{item.title}</h4>
      </div>

      <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <span>
          남은 시간: <b className={!item.isSubmitted && isUrgent ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}>{item.timeLeftText}</b>
        </span>
        <span className="font-medium text-zinc-400">터치 시 상세 정보 ›</span>
      </div>
    </div>
  );
};

export const AssignmentCard = React.memo(AssignmentCardInner);

