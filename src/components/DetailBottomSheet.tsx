import React, { useState, useRef, useEffect } from 'react';
import { AssignmentItem, NoticeItem } from '../types';
import { ExternalLink, Paperclip, CalendarPlus } from 'lucide-react';
import { LMS_BASE } from '../services/lmsAuth';
import { addDeadlineToCalendar } from '../services/appShell';

interface DetailBottomSheetProps {
  assignment: AssignmentItem | null;
  notice: NoticeItem | null;
  onClose: () => void;
}

export const DetailBottomSheet: React.FC<DetailBottomSheetProps> = ({
  assignment,
  notice,
  onClose,
}) => {
  const isOpen = Boolean(assignment || notice);
  // 마감이 남은 미제출 과제·퀴즈만 캘린더에 추가 가능
  const deadlineMs = assignment?.deadlineDate ? new Date(assignment.deadlineDate).getTime() : NaN;
  const canAddCalendar = !!assignment && !assignment.isSubmitted && deadlineMs > Date.now();

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta > 0) setDragY(delta);
  };

  const handleTouchEnd = () => {
    if (dragY > 100) onClose();
    setDragY(0);
    setIsDragging(false);
  };

  return (
    <>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 backdrop-blur-[1px] z-30 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <div
        className={`bottom-sheet absolute inset-x-0 bottom-0 max-h-[85%] bg-white dark:bg-zinc-900 border-t-2 border-hs-700 dark:border-hs-500 rounded-t-[32px] shadow-2xl z-40 flex flex-col p-5 overflow-hidden ${
          isOpen ? '' : 'closed'
        }`}
        style={isOpen && isDragging ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div
          className="w-12 h-1.5 bg-hs-200 dark:bg-hs-800 rounded-full mx-auto mb-4 cursor-pointer"
          onClick={onClose}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        <div className="flex-1 overflow-y-auto no-scrollbar space-y-3.5 pb-4">
          {assignment && (
            <>
              <div className="flex items-center justify-between">
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md ${
                    assignment.isSubmitted ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                  }`}
                >
                  {assignment.statusInfo || (assignment.isSubmitted ? '제출완료' : '미제출')}
                </span>
                <span className="text-xs font-bold text-hs-700 dark:text-hs-300">{assignment.courseNm}</span>
              </div>

              <h3 className="text-base font-black text-zinc-900 dark:text-white leading-snug">{assignment.title}</h3>

              <div className="text-xs text-zinc-500 space-y-1 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <div className="flex justify-between">
                  <span>마감 기한</span>
                  <b className="text-zinc-800 dark:text-zinc-200">{assignment.deadlineStr}</b>
                </div>
                <div className="flex justify-between">
                  <span>남은 시간</span>
                  <b className={assignment.isSubmitted ? 'text-zinc-700' : 'text-red-600 dark:text-red-400'}>
                    {assignment.timeLeftText}
                  </b>
                </div>
                <div className="flex justify-between">
                  <span>배점</span>
                  <b className="text-zinc-800 dark:text-zinc-200">{assignment.scoreText}</b>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-hs-700 dark:text-hs-300 mb-1">상세 내용</h4>
                <div className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-100 dark:border-zinc-800 whitespace-pre-line leading-relaxed">
                  {assignment.description || '상세 지침이 없습니다.'}
                </div>
              </div>
            </>
          )}

          {notice && (
            <>
              <div className="flex items-center justify-between">
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md ${
                    notice.isUrgent ? 'bg-red-600 text-white' : 'bg-zinc-100 text-zinc-700'
                  }`}
                >
                  {notice.isUrgent ? '🚨 긴급 공지' : '공지 전문'}
                </span>
                <span className="text-xs font-bold text-hs-700 dark:text-hs-300">{notice.courseNm}</span>
              </div>

              <h3 className="text-base font-black text-zinc-900 dark:text-white leading-snug">{notice.title}</h3>

              <div className="text-xs text-zinc-500 space-y-1 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <div className="flex justify-between">
                  <span>등록일</span>
                  <b className="text-zinc-800 dark:text-zinc-200">{notice.dateStr || '최근'}</b>
                </div>
                {notice.author && (
                  <div className="flex justify-between">
                    <span>작성자</span>
                    <b className="text-zinc-800 dark:text-zinc-200">{notice.author}</b>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold text-hs-700 dark:text-hs-300 mb-1">공지 본문</h4>
                <div className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-950 p-3.5 rounded-xl border border-zinc-100 dark:border-zinc-800 whitespace-pre-line leading-relaxed">
                  {notice.fullBody}
                </div>
              </div>

              {notice.attachments && notice.attachments.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-hs-700 dark:text-hs-300">첨부파일</h4>
                  {notice.attachments.map((file, i) => (
                    <div
                      key={i}
                      className="p-2.5 bg-hs-50 dark:bg-hs-950/60 rounded-xl flex items-center justify-between text-xs"
                    >
                      <span className="truncate text-hs-800 dark:text-hs-200 flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-hs-600 dark:text-hs-400" />
                        {file}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex gap-2">
          <a
            href={LMS_BASE}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-3 bg-hs-700 hover:bg-hs-800 dark:bg-hs-500 text-white text-center font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            LMS에서 확인하기
          </a>
          {canAddCalendar && (
            <button
              onClick={() =>
                addDeadlineToCalendar({
                  title: assignment!.title,
                  courseNm: assignment!.courseNm,
                  deadlineMs,
                  deadlineStr: assignment!.deadlineStr,
                }).catch(e => alert(e?.message || '캘린더를 열 수 없습니다.'))
              }
              className="px-3.5 py-3 bg-hs-50 dark:bg-hs-950/60 text-hs-700 dark:text-hs-300 font-bold text-xs rounded-xl flex items-center gap-1"
              aria-label="캘린더에 추가"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              캘린더
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold text-xs rounded-xl"
          >
            닫기
          </button>
        </div>
      </div>
    </>
  );
};
