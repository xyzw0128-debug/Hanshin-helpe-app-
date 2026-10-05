import { useState, useRef, useCallback } from 'react';
import { UserConfig, AppStateData, AssignmentItem, LectureItem, NoticeItem, Course, TodoListResult } from '../types';
import { saveAppState } from '../services/storage';
import { LmsAuthService, isCredentialsError } from '../services/lmsAuth';
import { LmsScraperService, isEmergencyNotice, parseLectureDeadline } from '../services/lmsScraper';
import { summarizeNoticeWithGemini } from '../services/gemini';
import { NotificationService, sanitizeDiscordText } from '../services/notifications';
import { parseNoticeDate } from '../utils/date';
import { getBackgroundSeenItems, markBackgroundItemsSeen, saveLmsSession } from '../services/backgroundSync';
import { debugLog } from '../services/debugLog';
import { canRelogin, SyncPausedError } from '../services/sessionGuard';

/** 저장해 두는 "이미 본 항목" ID 상한. 현재 목록에 있는 항목은 항상 남기고 오래된 것부터 정리 */
const MAX_SEEN_KEYS = 3000;

export function mergeSeenKeys(prev: string[], current: string[]): string[] {
  const currentSet = new Set(current);
  const older = prev.filter(k => !currentSet.has(k));
  const room = MAX_SEEN_KEYS - currentSet.size;
  return [...(room > 0 ? older.slice(-room) : []), ...currentSet];
}

const isSessionExpiredError = (e: any): boolean =>
  !!(e?.message?.includes('세션 만료') || e?.message?.includes('로그인이 필요합니다'));

/**
 * 과제/퀴즈 마감 예약 알림 동기화 (과제 ID 기반 1:1 고정 알림 ID → 재동기화 시 덮어쓰기, 제출 시 취소)
 */
export async function syncDeadlineReminders(assignments: AssignmentItem[], cfg: UserConfig): Promise<void> {
  const nowMs = Date.now();
  for (const a of assignments) {
    const dayKey = `${a.id}_reminder_d1`;
    const hourKey = `${a.id}_reminder_h3`;
    const deadlineMs = a.deadlineDate ? new Date(a.deadlineDate).getTime() : NaN;
    if (a.isSubmitted || isNaN(deadlineMs) || deadlineMs <= nowMs || !cfg.pushNotificationsEnabled) {
      await NotificationService.cancelNotification(dayKey);
      await NotificationService.cancelNotification(hourKey);
      continue;
    }
    if (cfg.ddayReminderEnabled) {
      await NotificationService.scheduleReminderNotification({
        id: dayKey,
        title: `⏰ [${a.courseNm}] 마감 하루 전`,
        body: `${a.title}\n기한: ${a.deadlineStr}`,
        scheduleAt: deadlineMs - 24 * 60 * 60 * 1000,
      });
    } else {
      await NotificationService.cancelNotification(dayKey);
    }
    if (cfg.threeHourReminderEnabled) {
      await NotificationService.scheduleReminderNotification({
        id: hourKey,
        title: `🔥 [${a.courseNm}] 마감 3시간 전`,
        body: `${a.title}\n기한: ${a.deadlineStr}`,
        scheduleAt: deadlineMs - 3 * 60 * 60 * 1000,
      });
    } else {
      await NotificationService.cancelNotification(hourKey);
    }
  }
}

export type TabType = 'home' | 'lms' | 'academics' | 'menu';

export interface SyncOptions {
  silent?: boolean;
  forceLogin?: boolean;
}

export function useLmsSync(
  config: UserConfig | null,
  state: AppStateData,
  setState: React.Dispatch<React.SetStateAction<AppStateData>>,
  setConfig: React.Dispatch<React.SetStateAction<UserConfig | null>>,
  setActiveTab: (tab: TabType) => void,
  showToast: (msg: string) => void,
  onCredentialsRejected: (cfg: UserConfig) => void
): {
  isSyncing: boolean;
  performSync: (userCfg?: UserConfig, curState?: AppStateData, options?: SyncOptions) => Promise<void>;
} {
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const backgroundSummaryTaskRef = useRef<number>(0);

  const configRef = useRef(config);
  configRef.current = config;
  const stateRef = useRef(state);
  stateRef.current = state;

  const performSync = useCallback(async (userCfg?: UserConfig, curState?: AppStateData, options?: SyncOptions) => {
    const silent = options?.silent ?? false;
    const forceLogin = options?.forceLogin ?? false;

    const activeCfg = userCfg || configRef.current;
    const activeState = curState || stateRef.current;
    if (!activeCfg || !activeCfg.userId || !activeCfg.userPw) {
      if (!silent) {
        setActiveTab('menu');
        showToast('로그인을 위해 아이디와 비밀번호를 먼저 입력해주세요.');
      }
      return;
    }

    setIsSyncing(true);
    const syncStartedAt = Date.now();
    debugLog('sync', 'LMS 동기화 시작', { silent, forceLogin });
    try {
      // 세션이 무효일 때만 SSO 재로그인. 다른 곳(PC) 로그인이 의심되면 재로그인하지 않음(PC 세션 보호)
      const reloginGuard = { enabled: activeCfg.protectPcSession !== false, interactive: !silent };
      const sessionState = forceLogin ? 'invalid' : await LmsAuthService.checkSession();
      // 네트워크 오류(error)로 세션 상태를 모르면 로그인하지 않고 바로 조회한다.
      // 세션이 살아 있는데 SSO 로그인을 하면 PC 세션을 끊으므로, 끊긴 게 확인될 때(아래 조회 실패)만 판단
      if (sessionState === 'invalid') {
        if (!forceLogin && !(await canRelogin(reloginGuard))) throw new SyncPausedError();
        if (!silent) showToast('LMS 서버 로그인 중...');
        await LmsAuthService.login(activeCfg.userId, activeCfg.userPw, true);
      }

      // 1. 과목 목록, 포털 공지사항, 통합 할일(과제/인강/퀴즈/공지)을 단일 라운드트립으로 병렬 고속 호출
      let courses: Course[];
      let portalNotices: NoticeItem[];
      let todoData: TodoListResult | null;

      // 세션 만료는 재인증 분기로 넘기고, 그 외 할일 조회 실패는 null(이전 데이터 유지)로 처리
      const fetchTodo = () =>
        LmsScraperService.getTodoList('all', [], { checkComplete: true }).catch(e => {
          if (isSessionExpiredError(e)) throw e;
          console.warn('Failed to fetch todo list', e);
          return null;
        });

      try {
        [courses, portalNotices, todoData] = await Promise.all([
          LmsScraperService.getCourses(),
          LmsScraperService.getPortalNotices().catch(e => {
            console.warn('Failed to fetch portal notices', e);
            return [] as NoticeItem[];
          }),
          fetchTodo(),
        ]);
      } catch (fetchErr: any) {
        if (isSessionExpiredError(fetchErr)) {
          debugLog('sync', '조회 중 세션 만료 감지 → 재인증 후 재시도');
          // 방금 확인한 세션이 조회 중 끊김 → 다른 곳 로그인 가능성이 높으므로 재로그인 전에 확인
          LmsAuthService.invalidateSession();
          if (!(await canRelogin(reloginGuard))) throw new SyncPausedError();
          await LmsAuthService.login(activeCfg.userId, activeCfg.userPw, true);
          [courses, portalNotices, todoData] = await Promise.all([
            LmsScraperService.getCourses(),
            LmsScraperService.getPortalNotices().catch(e => {
              console.warn('Failed to fetch portal notices retry', e);
              return [] as NoticeItem[];
            }),
            fetchTodo(),
          ]);
        } else {
          throw fetchErr;
        }
      }

      // 할일 조회 실패 시 빈 목록으로 덮어쓰지 않고 이전 과제/강의/과목 공지를 유지
      const todoFailed = todoData === null;
      if (todoFailed) debugLog('sync', '할일(doTodoList) 조회 실패 → 이전 과제/강의 유지');
      const todo: TodoListResult = todoData ?? {
        assignments: [],
        lectures: [],
        quizzes: [],
        notices: [],
        materials: [],
      };
      // 자료실: 조회 실패 시 이전 목록 유지
      const allMaterials = todoFailed ? activeState.materials || [] : todo.materials || [];

      // 과목 공식 명칭 맵 생성 및 수집된 데이터에 공식 과목명 정합성 부여
      const courseMap = new Map<string, string>();
      for (const c of courses) {
        if (c.course_id && c.course_nm) {
          courseMap.set(c.course_id, c.course_nm);
        }
      }
      for (const item of [...todo.assignments, ...todo.quizzes, ...todo.lectures, ...todo.notices, ...(todo.materials || [])]) {
        const canonicalNm = courseMap.get(item.courseId);
        if (canonicalNm) {
          item.courseNm = canonicalNm;
        }
      }

      // 기존 캐시된 과제 및 공지사항 맵 (제출 완료 상태 및 이미 요약된 본문 보존)
      const cachedAssignmentMap = new Map<string, AssignmentItem>();
      for (const a of activeState.assignments || []) {
        if (a.id) cachedAssignmentMap.set(a.id, a);
      }

      const cachedNoticeMap = new Map<string, NoticeItem>();
      for (const n of activeState.notices || []) {
        if (n.id) cachedNoticeMap.set(n.id, n);
      }

      // 2. Map을 사용하여 과제, 퀴즈, 강의, 공지의 중복 완벽 제거 (Deduplication)
      const assignmentMap = new Map<string, AssignmentItem>();
      const lectureMap = new Map<string, LectureItem>();
      const noticeMap = new Map<string, NoticeItem>();

      // 과제(tab5) 및 퀴즈/시험(tab7, tab8) 통합 적재
      for (const item of [...todo.assignments, ...todo.quizzes]) {
        if (!assignmentMap.has(item.id)) {
          const cached = cachedAssignmentMap.get(item.id);
          // 이전 상태에서 이미 제출완료로 확인된 경우 제출 상태 보존
          if (cached?.isSubmitted) {
            assignmentMap.set(item.id, {
              ...item,
              isSubmitted: true,
              statusInfo: '제출완료',
              badgeType: 'done',
              ddayBadgeText: '제출완료',
              timeLeftText: '제출완료됨',
            });
          } else {
            assignmentMap.set(item.id, item);
          }
        }
      }

      // 온라인 동영상 강의(tab2) 적재
      for (const l of todo.lectures) {
        if (!lectureMap.has(l.id)) {
          lectureMap.set(l.id, l);
        }
      }

      // 포털 전체 공지사항 (이러닝 긴급 공지, CTL 공지 등) 먼저 통합
      for (const pn of portalNotices) {
        if (!noticeMap.has(pn.id)) {
          const cached = cachedNoticeMap.get(pn.id);
          if (cached && (cached.fullBody || (cached.summaryLines && cached.summaryLines.length > 1))) {
            noticeMap.set(pn.id, {
              ...pn,
              author: cached.author || pn.author,
              dateStr: cached.dateStr || pn.dateStr,
              fullBody: cached.fullBody || pn.fullBody,
              summaryLines: cached.summaryLines || pn.summaryLines,
              isUrgent: cached.isUrgent !== undefined ? cached.isUrgent : pn.isUrgent,
              attachments: cached.attachments?.length ? cached.attachments : pn.attachments,
            });
          } else {
            noticeMap.set(pn.id, pn);
          }
        }
      }

      // doTodoList에서 수집된 과목별 공지사항(tab9) 통합
      for (const cn of todo.notices) {
        if (!noticeMap.has(cn.id)) {
          const cached = cachedNoticeMap.get(cn.id);
          if (cached && (cached.fullBody || (cached.summaryLines && cached.summaryLines.length > 1))) {
            noticeMap.set(cn.id, {
              ...cn,
              author: cached.author || cn.author,
              dateStr: cached.dateStr || cn.dateStr,
              fullBody: cached.fullBody || cn.fullBody,
              summaryLines: cached.summaryLines || cn.summaryLines,
              isUrgent: cached.isUrgent !== undefined ? cached.isUrgent : cn.isUrgent,
              attachments: cached.attachments?.length ? cached.attachments : cn.attachments,
            });
          } else {
            noticeMap.set(cn.id, cn);
          }
        }
      }

      if (todoFailed) {
        for (const a of activeState.assignments || []) {
          if (!assignmentMap.has(a.id)) assignmentMap.set(a.id, a);
        }
        for (const l of activeState.lectures || []) {
          if (!lectureMap.has(l.id)) lectureMap.set(l.id, l);
        }
        for (const n of activeState.notices || []) {
          if (!noticeMap.has(n.id)) noticeMap.set(n.id, n);
        }
      }

      const allAssignments = Array.from(assignmentMap.values());
      const allLectures = Array.from(lectureMap.values());
      const allNotices = Array.from(noticeMap.values());

      // 과제 및 퀴즈 정렬: 미제출/미응시 우선 + 마감일(D-Day) 빠른 순(오름차순) 정렬
      const nowMs = Date.now();
      allAssignments.sort((a, b) => {
        if (a.isSubmitted !== b.isSubmitted) {
          return a.isSubmitted ? 1 : -1;
        }
        if (a.deadlineDate && b.deadlineDate) {
          const aTime = new Date(a.deadlineDate).getTime();
          const bTime = new Date(b.deadlineDate).getTime();
          const aExpired = aTime < nowMs;
          const bExpired = bTime < nowMs;
          if (aExpired !== bExpired) {
            return aExpired ? 1 : -1;
          }
          if (!aExpired) {
            return aTime - bTime;
          } else {
            return bTime - aTime;
          }
        }
        if (!a.deadlineDate) return 1;
        if (!b.deadlineDate) return -1;
        return 0;
      });

      // 온라인 강의 정렬: 미수강 우선 + 진행 중인 활성 강의(마감 임박순)를 이미 지난 강의보다 상단 배치
      allLectures.sort((a, b) => {
        if (a.isAttended !== b.isAttended) {
          return a.isAttended ? 1 : -1;
        }
        const aDeadline = parseLectureDeadline(a.periodStr);
        const bDeadline = parseLectureDeadline(b.periodStr);
        const aHasDeadline = aDeadline !== Infinity;
        const bHasDeadline = bDeadline !== Infinity;

        if (aHasDeadline && bHasDeadline) {
          const aExpired = aDeadline < nowMs;
          const bExpired = bDeadline < nowMs;
          if (aExpired !== bExpired) {
            return aExpired ? 1 : -1; // 활성 강의 우선
          }
          if (!aExpired) {
            return aDeadline - bDeadline; // 활성 강의: 마감 빠른 순
          } else {
            return bDeadline - aDeadline; // 만료 강의: 최근 만료 순
          }
        }
        if (!aHasDeadline && bHasDeadline) return 1;
        if (aHasDeadline && !bHasDeadline) return -1;
        return a.title.localeCompare(b.title);
      });

      // 공지사항 전체를 등록 날짜 최신순 정렬
      allNotices.sort((a, b) => parseNoticeDate(b.dateStr) - parseNoticeDate(a.dateStr));

      // 3. 새 아이템 감지 및 알림 발송
      // 백그라운드 워커가 이미 알린 항목은 포그라운드에서 다시 알리지 않음
      const backgroundSeen = await getBackgroundSeenItems();
      const prevKeys = new Set(activeState.seenItemKeys || []);
      const hasHistory = prevKeys.size > 0;
      for (const id of backgroundSeen) prevKeys.add(id);
      const newKeys: string[] = [...backgroundSeen];

      for (const a of allAssignments) {
        newKeys.push(a.id);
        // 새 과제 알림 설정이 기준, 휴대폰 푸시는 푸시 알림 설정까지 켜져 있을 때만
        if (hasHistory && !prevKeys.has(a.id) && !a.isSubmitted && activeCfg.newAssignmentAlert !== false) {
          if (activeCfg.pushNotificationsEnabled !== false) {
            NotificationService.sendLocalNotification(
              `📝 [${a.courseNm}] 새 과제 등록!`,
              `${a.title}\n기한: ${a.deadlineStr}`,
              a.id
            );
          }
          if (activeCfg.discordWebhookUrl) {
            NotificationService.sendDiscordWebhook(
              activeCfg.discordWebhookUrl,
              `🔔 **[${a.courseNm}] 새 과제 등록!**\n**${a.title}**\n↳ 기한: ${a.deadlineStr}`
            );
          }
        }
      }

      for (const n of allNotices) {
        newKeys.push(n.id);
        if (hasHistory && !prevKeys.has(n.id) && activeCfg.newNoticeAlert !== false) {
          const prefix = n.isUrgent ? '🚨 긴급: ' : '📢 ';
          if (activeCfg.pushNotificationsEnabled !== false) {
            NotificationService.sendLocalNotification(
              `${prefix}[${n.courseNm}] 새 공지사항`,
              `${n.title}\n${n.summaryLines[0] || ''}`,
              n.id
            );
          }
          if (activeCfg.discordWebhookUrl) {
            const safeCourse = sanitizeDiscordText(n.courseNm);
            const safeTitle = sanitizeDiscordText(n.title);
            const safeSummary = (n.summaryLines || []).map(sanitizeDiscordText).join('\n↳ ');
            const prefix = n.isUrgent ? '🚨 **[긴급 공지]** ' : '📢 ';
            NotificationService.sendDiscordWebhook(
              activeCfg.discordWebhookUrl,
              `${prefix}**[${safeCourse}] 새 공지사항!**\n**${safeTitle}**\n↳ ${safeSummary}`
            );
          }
        }
      }

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 동기화 도중 사용자가 읽음 처리한 내용이 덮어써지지 않도록 최신 상태 기준으로 병합하고, 사라진 공지는 정리
      const noticeIdSet = new Set(allNotices.map(n => n.id));
      const latestReadIds = stateRef.current.readNoticeIds ?? activeState.readNoticeIds ?? [];
      const updatedState: AppStateData = {
        ...activeState,
        readNoticeIds: latestReadIds.filter(id => noticeIdSet.has(id)),
        materials: allMaterials,
        profile: {
          ...(activeState.profile || {}),
          name: LmsAuthService.getUserName() || activeState.profile?.name || '',
          studentNo: LmsAuthService.getUserNo() || activeState.profile?.studentNo || activeCfg.userId,
          dept: LmsAuthService.getDeptName() || activeState.profile?.dept || '',
        },
        lastSyncTime: timeStr,
        courses,
        assignments: allAssignments,
        lectures: allLectures,
        notices: allNotices,
        seenItemKeys: mergeSeenKeys(activeState.seenItemKeys || [], newKeys),
      };

      // 화면에 즉시 렌더링 (체감 속도 1~2초 달성)
      setState(updatedState);
      stateRef.current = updatedState;
      await saveAppState(updatedState);
      if (!silent) showToast('LMS 과제 및 강의 동기화 완료!');

      debugLog('sync', 'LMS 동기화 완료', {
        ms: Date.now() - syncStartedAt,
        courses: courses.length,
        assignments: allAssignments.length,
        lectures: allLectures.length,
        notices: allNotices.length,
        portalNotices: portalNotices.length,
        backgroundSeen: backgroundSeen.length,
        newItems: newKeys.filter(k => !prevKeys.has(k)).length,
        notified: hasHistory,
      });

      // 워커와 알림 이력 공유 + 세션 쿠키 사본 갱신 + 마감 예약 알림 갱신 (UI 차단 없음)
      markBackgroundItemsSeen([...allAssignments.map(a => a.id), ...allLectures.map(l => l.id)]);
      saveLmsSession();
      syncDeadlineReminders(allAssignments, activeCfg).catch(e => console.warn('Reminder sync failed', e));

      // 4. 백그라운드 비동기 AI 공지 요약 (UI 차단 없음)
      const apiKeyToUse = activeCfg.useGeminiSummary !== false ? activeCfg.geminiApiKey : '';
      const taskId = ++backgroundSummaryTaskRef.current;

      const unsummarizedNotices = allNotices.filter(
        n => n.boardNo && n.boardItemNo && (!n.fullBody || n.fullBody === n.title)
      ).slice(0, 5); // 최근 미요약 공지 상위 5건만 선별 처리

      if (unsummarizedNotices.length > 0) {
        (async () => {
          let hasChanges = false;
          for (const n of unsummarizedNotices) {
            if (backgroundSummaryTaskRef.current !== taskId) break;
            try {
              let detail;
              if (n.courseId === 'PORTAL_LMS' || n.boardNo === '14' || n.boardNo === '140') {
                detail = await LmsScraperService.getBoardItemDetail(
                  'PORTAL_LMS',
                  '',
                  n.boardNo!,
                  n.boardItemNo!
                );
              } else {
                const course = courses.find(c => c.course_id === n.courseId);
                if (!course) continue;

                detail = await LmsScraperService.getBoardItemDetail(
                  course.course_id,
                  course.class_no,
                  n.boardNo!,
                  n.boardItemNo!
                );
              }

              // 불변성 유지: 새 객체로 업데이트
              const updated: Partial<NoticeItem> = {};
              if (detail.title) updated.title = detail.title;
              if (detail.author) updated.author = detail.author;
              if (detail.date) updated.dateStr = detail.date;
              if (detail.body) updated.fullBody = detail.body;
              if (detail.attachments.length > 0) updated.attachments = detail.attachments;

              if (apiKeyToUse) {
                const summary = await summarizeNoticeWithGemini(
                  apiKeyToUse,
                  updated.title || n.title,
                  updated.fullBody || n.fullBody,
                  updated.attachments || n.attachments
                );
                updated.isUrgent = n.isUrgent || summary.isUrgent || isEmergencyNotice(updated.title || n.title, updated.fullBody || n.fullBody);
                updated.summaryLines = summary.summaryLines;
              } else {
                if (!updated.isUrgent) {
                  updated.isUrgent = isEmergencyNotice(updated.title || n.title, updated.fullBody || n.fullBody);
                }
                if ((updated.fullBody || n.fullBody) && (updated.fullBody || n.fullBody) !== (updated.title || n.title)) {
                  const body = updated.fullBody || n.fullBody || '';
                  const lines = body
                    .split(/[\n\r]+/)
                    .map(l => l.trim())
                    .filter(l => l.length > 5 && !l.startsWith('http'));
                  if (lines.length > 0) {
                    updated.summaryLines = lines.slice(0, 3);
                  }
                }
              }

              // 원본 객체를 변이하지 않고 새 객체로 대체
              const idx = unsummarizedNotices.indexOf(n);
              if (idx >= 0) {
                unsummarizedNotices[idx] = { ...n, ...updated };
              }
              hasChanges = true;
            } catch (err) {
              console.warn('Background notice summary error', err);
            }
          }

          if (hasChanges && backgroundSummaryTaskRef.current === taskId) {
            // setState 업데이터 실행 시점에 의존하지 않도록 최신 상태에서 직접 계산 후 반영
            const base = stateRef.current;
            const finalNotices = base.notices.map(existing => {
              const found = unsummarizedNotices.find(u => u.id === existing.id);
              return found || existing;
            });
            const latestState = { ...base, notices: finalNotices };
            stateRef.current = latestState;
            setState(latestState);
            await saveAppState(latestState);
          }
        })();
      }
    } catch (e: any) {
      if (e instanceof SyncPausedError) {
        debugLog('sync', '다른 곳 로그인 의심 → 재로그인 없이 동기화 중단', { silent });
        if (!silent) showToast('다시 로그인하지 않았어요. 동기화가 멈춘 상태예요.');
        return;
      }
      debugLog('sync', 'LMS 동기화 실패', { error: e?.message || String(e), ms: Date.now() - syncStartedAt });
      console.error('Sync failed', e);
      if (isCredentialsError(e)) {
        // 저장된 비밀번호로 더 시도하지 않도록(포털 계정 잠김 방지) 로그인 화면으로 돌려보냄
        onCredentialsRejected(activeCfg);
      } else {
        if (!silent) {
          showToast(e.message || 'LMS 동기화에 실패했습니다.');
        }
      }
    } finally {
      setIsSyncing(false);
    }
  }, [setIsSyncing, setState, setConfig, setActiveTab, showToast, onCredentialsRejected]);

  return { isSyncing, performSync };
}

