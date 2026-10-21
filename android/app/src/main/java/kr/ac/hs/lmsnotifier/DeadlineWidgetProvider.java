package kr.ac.hs.lmsnotifier;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * 홈 화면 위젯 "다가오는 마감": 마감 알림 목록(DeadlineReminders)에서 가장 가까운 3건. 줄을 누르면 그 항목 상세, 나머지는 과제 목록.
 * 다시 그리는 때: 목록이 바뀔 때(앱 동기화·백그라운드 확인), 가장 가까운 마감이 지나거나 자정에 날짜가 바뀔 때(ACTION_TICK 알람),
 * 그리고 알람이 사라졌을 때(강제 종료 등)를 대비한 30분 주기(updatePeriodMillis).
 */
public class DeadlineWidgetProvider extends AppWidgetProvider {
    static final String ACTION_TICK = "kr.ac.hs.lmsnotifier.WIDGET_TICK";

    // PendingIntent 요청 코드: 위젯 전체 7401, 줄마다 7402~7404, 다시 그리기 알람 7410
    private static final int REQ_OPEN = 7401;
    private static final int REQ_ROW = 7402;
    private static final int REQ_TICK = 7410;

    private static final int[] ROW_IDS = {R.id.widget_row_0, R.id.widget_row_1, R.id.widget_row_2};
    // 배지는 평상시용·급함용을 따로 두고 보이기만 바꿈: 색을 코드에서 정하면 그 순간 테마 색으로 고정돼
    // 다크 모드로 바뀌어도 글자색이 안 바뀜 (레이아웃의 @color는 그릴 때마다 현재 테마로 풀림)
    private static final int[] BADGE_IDS = {R.id.widget_badge_0, R.id.widget_badge_1, R.id.widget_badge_2};
    private static final int[] URGENT_BADGE_IDS = {R.id.widget_badge_urgent_0, R.id.widget_badge_urgent_1, R.id.widget_badge_urgent_2};
    private static final int[] TITLE_IDS = {R.id.widget_title_0, R.id.widget_title_1, R.id.widget_title_2};

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_TICK.equals(intent.getAction())) {
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        long now = System.currentTimeMillis();
        List<DeadlineReminders.Item> items = DeadlineReminders.upcoming(context, now);
        RemoteViews views = build(context, items, now);
        for (int id : appWidgetIds) manager.updateAppWidget(id, views);
        scheduleTick(context, items, now);
    }

    @Override
    public void onDisabled(Context context) {
        cancelTick(context); // 마지막 위젯을 지움
    }

    /** 설치된 위젯을 모두 다시 그림 (위젯이 없으면 다시 그리기 알람만 정리) */
    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, DeadlineWidgetProvider.class));
            if (ids == null || ids.length == 0) {
                cancelTick(context);
                return;
            }
            long now = System.currentTimeMillis();
            List<DeadlineReminders.Item> items = DeadlineReminders.upcoming(context, now);
            RemoteViews views = build(context, items, now);
            for (int id : ids) manager.updateAppWidget(id, views);
            scheduleTick(context, items, now);
        } catch (Exception e) {
            DebugLog.log(context, "widget", "refresh failed: " + e.getMessage());
        }
    }

    private static RemoteViews build(Context context, List<DeadlineReminders.Item> items, long now) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_deadlines);

        for (int i = 0; i < ROW_IDS.length; i++) {
            if (i < items.size()) {
                DeadlineReminders.Item it = items.get(i);
                BadgeText badge = badge(it.deadlineMs, now);
                views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                views.setTextViewText(BADGE_IDS[i], badge.text);
                views.setTextViewText(URGENT_BADGE_IDS[i], badge.text);
                views.setViewVisibility(BADGE_IDS[i], badge.urgent ? View.GONE : View.VISIBLE);
                views.setViewVisibility(URGENT_BADGE_IDS[i], badge.urgent ? View.VISIBLE : View.GONE);
                String prefix = DeadlineReminders.KIND_LECTURE.equals(it.kind) ? "[강의] " : "";
                String course = it.courseNm == null || it.courseNm.isEmpty() ? "" : " · " + it.courseNm;
                views.setTextViewText(TITLE_IDS[i], prefix + it.title + course);
                // 줄을 누르면 그 항목 상세 (마감 알림을 눌렀을 때와 같은 화면)
                PendingIntent openItem = PendingIntent.getActivity(context, REQ_ROW + i,
                        MainActivity.openIntent(context, DeadlineReminders.openTarget(it), it.id),
                        PendingIntent.FLAG_UPDATE_CURRENT | DeadlineReminders.immutableFlag());
                views.setOnClickPendingIntent(ROW_IDS[i], openItem);
            } else {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        }

        long checkedAt = DeadlineReminders.checkedAt(context);
        views.setViewVisibility(R.id.widget_empty, items.isEmpty() ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_empty, context.getString(
                isSignedIn(context, checkedAt) ? R.string.widget_deadlines_empty : R.string.widget_deadlines_signed_out));
        views.setTextViewText(R.id.widget_meta, meta(items.size(), checkedAt, now));

        PendingIntent open = PendingIntent.getActivity(context, REQ_OPEN,
                MainActivity.openIntent(context, "lms:assignments", null),
                PendingIntent.FLAG_UPDATE_CURRENT | DeadlineReminders.immutableFlag());
        views.setOnClickPendingIntent(R.id.widget_root, open);
        return views;
    }

    /**
     * 로그인한 적이 있는지: 목록을 학교 서버와 맞춘 적이 있거나(로그아웃하면 지워짐) 워커용 세션 쿠키 사본이 있음.
     * 쿠키도 함께 보는 이유: 확인 시각을 기록하기 전 버전에서 업데이트한 직후에는 확인 시각이 아직 없음
     */
    private static boolean isSignedIn(Context context, long checkedAt) {
        if (checkedAt > 0) return true;
        return context.getSharedPreferences(BackgroundSyncWorker.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(BackgroundSyncWorker.PREF_SESSION_COOKIE, null) != null;
    }

    /** 제목 줄 오른쪽 "외 2건 · 14:30 확인" (위젯이 30분 넘게 안 그려질 수 있어 "n분 전" 대신 시각으로 표시) */
    private static String meta(int total, long checkedAt, long now) {
        StringBuilder sb = new StringBuilder();
        if (total > ROW_IDS.length) sb.append("외 ").append(total - ROW_IDS.length).append("건");
        if (checkedAt > 0) {
            if (sb.length() > 0) sb.append(" · ");
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(checkedAt);
            long days = Math.round((startOfDay(now) - startOfDay(checkedAt)) / 86_400_000.0);
            String hm = String.format(Locale.KOREA, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
            if (days <= 0) sb.append(hm);
            else if (days == 1) sb.append("어제 ").append(hm);
            else sb.append(c.get(Calendar.MONTH) + 1).append('/').append(c.get(Calendar.DAY_OF_MONTH));
            sb.append(" 확인");
        }
        return sb.toString();
    }

    /**
     * 위젯 내용이 다음에 바뀌는 때(가장 가까운 마감이 지남, 자정에 배지·"어제" 표시가 바뀜)에 다시 그리도록 예약.
     * 기기를 깨우지 않는 알람이라 화면이 꺼져 있으면 미뤄졌다가 켜질 때 울림 (위젯은 화면이 켜져야 보이므로 충분)
     */
    private static void scheduleTick(Context context, List<DeadlineReminders.Item> items, long now) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = nextMidnight(now);
        if (!items.isEmpty()) at = Math.min(at, items.get(0).deadlineMs);
        at += 1000; // 경계를 넘긴 뒤에 그려야 지난 마감이 빠지고 날짜가 바뀜
        PendingIntent pi = tickIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (exact) am.setExact(AlarmManager.RTC, at, pi);
            else am.setWindow(AlarmManager.RTC, at, 10 * 60_000L, pi); // 정확한 알람 권한이 없으면 10분 안쪽
        } catch (SecurityException e) {
            DebugLog.log(context, "widget", "tick schedule failed: " + e.getMessage());
        }
    }

    private static void cancelTick(Context context) {
        PendingIntent pi = tickIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (pi == null) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pi);
        pi.cancel();
    }

    private static PendingIntent tickIntent(Context context, int flags) {
        Intent intent = new Intent(context, DeadlineWidgetProvider.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(context, REQ_TICK, intent, flags | DeadlineReminders.immutableFlag());
    }

    private static class BadgeText {
        final String text;
        final boolean urgent;

        BadgeText(String text, boolean urgent) {
            this.text = text;
            this.urgent = urgent;
        }
    }

    /** 앱의 formatDeadlineBadge(src/utils/date.ts)와 같은 규칙: 오늘 마감 → "오늘 23:59", 그 외 → 달력 기준 "D-n" */
    private static BadgeText badge(long deadlineMs, long now) {
        Calendar d = Calendar.getInstance();
        d.setTimeInMillis(deadlineMs);
        long days = Math.round((startOfDay(deadlineMs) - startOfDay(now)) / 86_400_000.0);
        if (days <= 0) {
            return new BadgeText(String.format(Locale.KOREA, "오늘 %02d:%02d", d.get(Calendar.HOUR_OF_DAY), d.get(Calendar.MINUTE)), true);
        }
        return new BadgeText("D-" + days, days <= 1);
    }

    private static long startOfDay(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static long nextMidnight(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(startOfDay(ms));
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }
}
