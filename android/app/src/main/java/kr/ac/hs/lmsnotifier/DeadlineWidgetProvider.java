package kr.ac.hs.lmsnotifier;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * 홈 화면 위젯 "다가오는 마감": 마감 알림 목록(DeadlineReminders)에서 가장 가까운 3건.
 * 목록이 바뀔 때(앱 동기화·백그라운드 확인)와 30분마다(updatePeriodMillis, D-day 갱신) 다시 그림.
 */
public class DeadlineWidgetProvider extends AppWidgetProvider {
    private static final int[] ROW_IDS = {R.id.widget_row_0, R.id.widget_row_1, R.id.widget_row_2};
    // 배지는 평상시용·급함용을 따로 두고 보이기만 바꿈: 색을 코드에서 정하면 그 순간 테마 색으로 고정돼
    // 다크 모드로 바뀌어도 글자색이 안 바뀜 (레이아웃의 @color는 그릴 때마다 현재 테마로 풀림)
    private static final int[] BADGE_IDS = {R.id.widget_badge_0, R.id.widget_badge_1, R.id.widget_badge_2};
    private static final int[] URGENT_BADGE_IDS = {R.id.widget_badge_urgent_0, R.id.widget_badge_urgent_1, R.id.widget_badge_urgent_2};
    private static final int[] TITLE_IDS = {R.id.widget_title_0, R.id.widget_title_1, R.id.widget_title_2};

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        RemoteViews views = build(context);
        for (int id : appWidgetIds) manager.updateAppWidget(id, views);
    }

    /** 설치된 위젯을 모두 다시 그림 (위젯이 없으면 아무것도 안 함) */
    static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, DeadlineWidgetProvider.class));
            if (ids == null || ids.length == 0) return;
            RemoteViews views = build(context);
            for (int id : ids) manager.updateAppWidget(id, views);
        } catch (Exception e) {
            DebugLog.log(context, "widget", "refresh failed: " + e.getMessage());
        }
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_deadlines);
        long now = System.currentTimeMillis();
        List<DeadlineReminders.Item> items = DeadlineReminders.upcoming(context, now);

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
            } else {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        }
        views.setViewVisibility(R.id.widget_empty, items.isEmpty() ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_count, items.size() > ROW_IDS.length ? "외 " + (items.size() - ROW_IDS.length) + "건" : "");

        PendingIntent open = PendingIntent.getActivity(context, 7401,
                MainActivity.openIntent(context, "lms:assignments", null),
                PendingIntent.FLAG_UPDATE_CURRENT | DeadlineReminders.immutableFlag());
        views.setOnClickPendingIntent(R.id.widget_root, open);
        return views;
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
}
