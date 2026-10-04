import React from 'react';
import { NoticeItem } from '../types';
import { Sparkles, Paperclip } from 'lucide-react';

interface NoticeCardProps {
  item: NoticeItem;
  isRead?: boolean;
  onClick: () => void;
}

const NoticeCardInner: React.FC<NoticeCardProps> = ({ item, isRead = true, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-zinc-900 border ${
        item.isUrgent ? 'border-2 border-red-500/30' : 'border-zinc-200 dark:border-zinc-800'
      } p-4 rounded-2xl shadow-sm space-y-3 cursor-pointer active:scale-[0.99] transition-transform`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`px-2 py-0.5 text-xs font-black rounded-md ${
            item.isUrgent ? 'bg-red-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
        >
          {item.isUrgent ? '🚨 긴급 공지' : '일반 공지'}
        </span>
        <span className="text-xs text-zinc-400 flex items-center gap-1.5">
          {!isRead && (
            <span className="px-1.5 py-0.5 bg-hs-700 dark:bg-hs-500 text-white text-[10px] font-black rounded-full leading-none">
              N
            </span>
          )}
          {item.dateStr || '최근'} 등록 • 터치 시 전문
        </span>
      </div>

      <div>
        <span className="text-xs text-hs-700 dark:text-hs-300 font-semibold">{item.courseNm}</span>
        <h4 className={`text-sm mt-0.5 ${isRead ? 'font-semibold text-zinc-600 dark:text-zinc-400' : 'font-bold text-zinc-900 dark:text-white'}`}>
          {item.title}
        </h4>
        {item.attachments && item.attachments.length > 0 && (
          <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1">
            <Paperclip className="w-3 h-3 text-zinc-400" />
            첨부파일 {item.attachments.length}개
          </p>
        )}
      </div>

      <div className="p-3 bg-hs-50 dark:bg-hs-950/60 border border-hs-200 dark:border-hs-800 rounded-xl space-y-1.5">
        <div className="text-xs font-bold text-hs-700 dark:text-hs-300 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-amber-500" /> 핵심 요약
        </div>
        <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-1 pl-1 leading-relaxed">
          {item.summaryLines.map((line, idx) => (
            <li key={idx}>• {line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export const NoticeCard = React.memo(NoticeCardInner);
