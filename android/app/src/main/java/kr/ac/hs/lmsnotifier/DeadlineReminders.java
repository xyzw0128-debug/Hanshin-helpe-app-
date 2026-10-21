package kr.ac.hs.lmsnotifier;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kr.ac.hs.lmsnotifier.TodoListParser.TodoItem;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 마감 하루 전·3시간 전 알림 (과제·퀴즈·온라인 강의).
 *
 * 앱(동기화 결과 전체)과 백그라운드 워커(새 항목 추가, 완료 목록에 오른 항목 제거)가 같은 목록을 고쳐 쓰고,
 * 목록이 바뀔 때마다 AlarmManager 예약을 전부 다시 맞춘다. PC에서 제출해도 앱을 열기 전에 워커가 알림을 지운다.
 * 화면이 꺼져 있어도 울리도록 allowWhileIdle 알람을 쓰고, 재부팅·앱 업데이트 뒤에는 BootReceiver가 다시 예약한다.
 * 홈 화면 위젯(DeadlineWidgetProvider)도 이 목록을 보여 준다.
 */
public final class DeadlineReminders {
    private DeadlineReminders() {
    }

    static final String PREFS = "hs_lms_reminders";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_D1 = "d1";
    private static final String KEY_H3 = "h3";
    private static final String KEY_SCHEDULED = "scheduled"; // 예약해 둔 알람 URI (다음 갱신 때 취소용)
    // 목록을 학교 서버와 마지막으로 맞춘 시각(epoch ms): 앱 동기화 성공·백그라운드 확인 성공. 위젯에 "14:30 확인"으로 표시, 로그아웃 때 지움
    private static final String KEY_CHECKED_AT = "checked_at";

    static final String ACTION_REMIND = "kr.ac.hs.lmsnotifier.DEADLINE_REMINDER";
    static final String EXTRA_ITEM_ID = "item_id";
    static final String EXTRA_SLOT = "slot";
    static final String SLOT_D1 = "d1";
    static final String SLOT_H3 = "h3";

    static final String CHANNEL_ID = "lms_deadline";
    static final String CHANNEL_NAME = "마감 알림";

    static final long DAY_MS = 24L * 60 * 60 * 1000;
    static final long H3_MS = 3L * 60 * 60 * 1000;

    public static final String KIND_ASSIGNMENT = "assignment";
    public static final String KIND_QUIZ = "quiz";
    public static final String KIND_LECTURE = "lecture";

    public static class Item {
        public String id;
        public String kind;
        public String courseNm;
        public String title;
        public String deadlineStr;
        public long deadlineMs;

        JSONObject toJson() throws org.json.JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("kind", kind);
            o.put("courseNm", courseNm);
            o.put("title", title);
            o.put("deadlineStr", deadlineStr);
            o.put("deadlineMs", deadlineMs);
            return o;
        }

        static Item fromJson(JSONObject o) {
            Item it = new Item();
            it.id = o.optString("id", "");
            it.kind = o.optString("kind", KIND_ASSIGNMENT);
            it.courseNm = o.optString("courseNm", "");
            it.title = o.optString("title", "");
            it.deadlineStr = o.optString("deadlineStr", "");
            it.deadlineMs = o.optLong("deadlineMs", 0L);
            return it;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized List<Item> load(Context context) {
        List<Item> items = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(context).getString(KEY_ITEMS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                Item it = Item.fromJson(arr.getJSONObject(i));
                if (!it.id.isEmpty() && it.deadlineMs > 0) items.add(it);
            }
        } catch (Exception e) {
            DebugLog.log(context, "reminder", "load failed: " + e.getMessage());
        }
        return items;
    }

    private static void save(Context context, List<Item> items) {
        JSONArray arr = new JSONArray();
        for (Item it : items) {
            try {
                arr.put(it.toJson());
            } catch (Exception ignored) {
            }
        }
        prefs(context).edit().putString(KEY_ITEMS, arr.toString()).apply();
    }

    /**
     * 앱 동기화 결과로 목록 전체를 교체 (앱이 제출·수강 여부를 가장 정확히 앎).
     * checkedAt: 방금 학교 서버에서 받아 온 목록이면 그 시각, 저장해 둔 목록으로 다시 예약만 하는 경우(앱 시작·설정 변경)는 0
     */
    static synchronized void replaceAll(Context context, List<Item> items, boolean enabled, boolean d1, boolean h3, long checkedAt) {
        SharedPreferences.Editor edit = prefs(context).edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putBoolean(KEY_D1, d1)
                .putBoolean(KEY_H3, h3);
        if (checkedAt > checkedAt(context)) edit.putLong(KEY_CHECKED_AT, checkedAt);
        edit.apply();
        save(context, items);
        reschedule(context);
        DebugLog.log(context, "reminder", "replaceAll items=" + items.size() + " (" + countByKind(items) + ") enabled=" + enabled
                + " d1=" + d1 + " h3=" + h3);
    }

    /**
     * 백그라운드 확인 결과 반영: 완료 목록에 오른 항목(제출·수강 완료)은 알림을 지우고,
     * 진행 중 목록에서 처음 보는 항목은 알림을 새로 예약하고, 이미 있는 항목은 마감이 바뀌었으면(연장 등) 새 마감으로 고친다.
     */
    static synchronized void applyWorkerResult(Context context, List<TodoItem> pending, Set<String> completedIds, long now) {
        MergeResult r = merge(load(context), pending, completedIds, now);
        if (r.changed()) save(context, r.next);
        prefs(context).edit().putLong(KEY_CHECKED_AT, now).apply();
        // 바뀐 것이 없어도 다시 예약: 강제 종료·정확한 알람 권한 해제 때 시스템이 알람을 지우므로 확인할 때마다 복구
        reschedule(context);
        DebugLog.log(context, "reminder", "worker result: +" + r.added + " -" + r.removed.size() + " ~" + r.updated
                + (r.removed.isEmpty() ? "" : " (completed: " + countByKind(r.removed) + ")") + " (total " + r.next.size() + ")");
    }

    /** merge 결과: 새 목록, 지운 항목(완료), 더한 수, 마감을 고친 수 */
    static final class MergeResult {
        final List<Item> next = new ArrayList<>();
        final List<Item> removed = new ArrayList<>();
        int added;
        int updated;

        boolean changed() {
            return !removed.isEmpty() || added > 0 || updated > 0;
        }
    }

    /** applyWorkerResult의 목록 계산 (기기 기능을 쓰지 않아 단위 테스트 가능: DeadlineRemindersTest) */
    static MergeResult merge(List<Item> items, List<TodoItem> pending, Set<String> completedIds, long now) {
        MergeResult r = new MergeResult();
        Map<String, Item> known = new HashMap<>();
        for (Item it : items) {
            if (completedIds.contains(it.id)) {
                r.removed.add(it);
                continue;
            }
            r.next.add(it);
            known.put(it.id, it);
        }
        for (TodoItem t : pending) {
            if (!t.isPending) continue;
            String kind = kindOfTab(t.tab);
            if (kind == null) continue;
            long deadline = TodoListParser.parseDeadlineMs(t.dateStr);
            if (deadline == Long.MAX_VALUE || deadline <= now) continue;
            Item existing = known.get(t.id);
            if (existing != null) {
                // 마감이 바뀜(연장 등): 그대로 두면 옛 마감 기준으로 "하루 전" 알림이 울리고,
                // 옛 마감이 지나면 알림·위젯에서 빠져 새 마감 알림이 없음 (앱에서 동기화할 때까지)
                if (existing.deadlineMs != deadline) {
                    existing.deadlineMs = deadline;
                    existing.deadlineStr = t.dateStr;
                    r.updated++;
                }
                continue;
            }
            Item it = new Item();
            it.id = t.id;
            it.kind = kind;
            it.courseNm = t.courseNm;
            it.title = KIND_LECTURE.equals(kind) ? TodoListParser.stripProgress(t.title) : t.title;
            it.deadlineStr = t.dateStr;
            it.deadlineMs = deadline;
            r.next.add(it);
            known.put(it.id, it);
            r.added++;
        }
        return r;
    }

    static String kindOfTab(String tab) {
        if ("tab5".equals(tab)) return KIND_ASSIGNMENT;
        if ("tab7".equals(tab) || "tab8".equals(tab)) return KIND_QUIZ;
        if ("tab2".equals(tab)) return KIND_LECTURE;
        return null;
    }

    /** 로그아웃: 목록과 예약을 모두 지움 */
    static synchronized void clear(Context context) {
        prefs(context).edit().remove(KEY_CHECKED_AT).apply();
        save(context, new ArrayList<>());
        reschedule(context);
    }

    /** 목록을 학교 서버와 마지막으로 맞춘 시각 (아직 없거나 로그아웃 뒤면 0) */
    static long checkedAt(Context context) {
        return prefs(context).getLong(KEY_CHECKED_AT, 0L);
    }

    /** 항목을 열 화면 (알림·위젯을 눌렀을 때): 온라인 강의는 강의 목록, 과제·퀴즈는 과제 목록 */
    static String openTarget(Item it) {
        return KIND_LECTURE.equals(it.kind) ? "lms:lectures" : "lms:assignments";
    }

    /** 다가오는 마감 (위젯용): 마감이 지나지 않은 항목을 마감 순으로 */
    static List<Item> upcoming(Context context, long now) {
        List<Item> list = new ArrayList<>();
        for (Item it : load(context)) {
            if (it.deadlineMs > now) list.add(it);
        }
        Collections.sort(list, (a, b) -> Long.compare(a.deadlineMs, b.deadlineMs));
        return list;
    }

    /** 기존 예약을 모두 취소하고 현재 목록·설정대로 다시 예약 (항목 수가 적어 매번 전부 맞춤) */
    static synchronized void reschedule(Context context) {
        SharedPreferences p = prefs(context);
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        for (String uri : p.getStringSet(KEY_SCHEDULED, new HashSet<>())) {
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, alarmIntent(context, Uri.parse(uri), null, null),
                    PendingIntent.FLAG_NO_CREATE | immutableFlag());
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }

        Set<String> scheduled = new HashSet<>();
        boolean enabled = p.getBoolean(KEY_ENABLED, true);
        long now = System.currentTimeMillis();
        // 진단 로그용: 가장 먼저 울릴 알람
        long nextAt = Long.MAX_VALUE;
        String nextWhat = "";
        if (enabled) {
            for (Item it : load(context)) {
                long d1At = it.deadlineMs - DAY_MS;
                long h3At = it.deadlineMs - H3_MS;
                if (p.getBoolean(KEY_D1, true) && schedule(context, am, it, SLOT_D1, d1At, now, scheduled) && d1At < nextAt) {
                    nextAt = d1At;
                    nextWhat = it.kind + " " + SLOT_D1;
                }
                if (p.getBoolean(KEY_H3, true) && schedule(context, am, it, SLOT_H3, h3At, now, scheduled) && h3At < nextAt) {
                    nextAt = h3At;
                    nextWhat = it.kind + " " + SLOT_H3;
                }
            }
        }
        p.edit().putStringSet(KEY_SCHEDULED, scheduled).apply();
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        DebugLog.log(context, "reminder", "scheduled " + scheduled.size() + " alarms (enabled=" + enabled + ", exact=" + exact + ")"
                + (nextAt == Long.MAX_VALUE ? "" : ", next "
                + new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.KOREA).format(new java.util.Date(nextAt)) + " " + nextWhat));
        DeadlineWidgetProvider.refreshAll(context);
    }

    /** 알람 하나 예약. 예약했으면 true (이미 지난 시각이거나 실패하면 false) */
    private static boolean schedule(Context context, AlarmManager am, Item it, String slot, long at, long now, Set<String> scheduled) {
        if (at <= now) return false;
        Uri uri = alarmUri(it.id, slot);
        PendingIntent pi = PendingIntent.getBroadcast(context, 0, alarmIntent(context, uri, it.id, slot),
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // 화면이 꺼진 절전 상태에서도 기기를 깨워 울림 (정확한 알람 권한이 없으면 몇 분 늦을 수 있음)
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
            scheduled.add(uri.toString());
            return true;
        } catch (SecurityException e) {
            DebugLog.log(context, "reminder", "schedule failed: " + e.getMessage());
            return false;
        }
    }

    /** 진단 로그용 "assignment 2, lecture 1" */
    private static String countByKind(List<Item> items) {
        int a = 0, q = 0, l = 0;
        for (Item it : items) {
            if (KIND_LECTURE.equals(it.kind)) l++;
            else if (KIND_QUIZ.equals(it.kind)) q++;
            else a++;
        }
        return "assignment " + a + ", quiz " + q + ", lecture " + l;
    }

    private static Uri alarmUri(String itemId, String slot) {
        return new Uri.Builder().scheme("hsreminder").authority(slot).appendPath(itemId).build();
    }

    private static Intent alarmIntent(Context context, Uri uri, String itemId, String slot) {
        Intent intent = new Intent(context, DeadlineReminderReceiver.class);
        intent.setAction(ACTION_REMIND);
        intent.setData(uri); // 항목·시점마다 다른 PendingIntent가 되도록
        if (itemId != null) intent.putExtra(EXTRA_ITEM_ID, itemId);
        if (slot != null) intent.putExtra(EXTRA_SLOT, slot);
        return intent;
    }

    static int immutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    /** 알람 시각에 호출: 항목이 아직 목록에 있고 마감 전일 때만 알림 */
    static void fire(Context context, String itemId, String slot) {
        SharedPreferences p = prefs(context);
        DebugLog.log(context, "reminder", "alarm " + slot + " received (enabled=" + p.getBoolean(KEY_ENABLED, true) + ")");
        if (!p.getBoolean(KEY_ENABLED, true)) return;
        if (SLOT_D1.equals(slot) && !p.getBoolean(KEY_D1, true)) return;
        if (SLOT_H3.equals(slot) && !p.getBoolean(KEY_H3, true)) return;

        Item item = null;
        for (Item it : load(context)) {
            if (it.id.equals(itemId)) {
                item = it;
                break;
            }
        }
        long now = System.currentTimeMillis();
        if (item == null || item.deadlineMs <= now) {
            DebugLog.log(context, "reminder", "fire skipped (" + slot + "): " + (item == null ? "item gone" : "deadline passed"));
            return;
        }

        boolean lecture = KIND_LECTURE.equals(item.kind);
        String when = SLOT_D1.equals(slot) ? "마감 하루 전" : "마감 3시간 전";
        String emoji = SLOT_D1.equals(slot) ? "⏰ " : "🔥 ";
        String course = item.courseNm == null || item.courseNm.isEmpty() ? "" : "[" + item.courseNm + "] ";
        String title = emoji + course + (lecture ? "온라인 강의 " : "") + when;
        String body = item.title + (item.deadlineStr == null || item.deadlineStr.isEmpty() ? "" : "\n기한: " + item.deadlineStr);

        int notifId = (itemId + "|" + slot).hashCode() & 0x7FFFFFFF;
        post(context, CHANNEL_ID, CHANNEL_NAME, "과제·퀴즈·온라인 강의 마감 전 알림", notifId, title, body, openTarget(item), itemId);
        DebugLog.log(context, "reminder", "fired " + slot + " for " + item.kind);
    }

    /**
     * 알림 하나를 띄움. 누르면 앱의 해당 화면(target: "lms:assignments" 등)과 항목(itemId)으로 이동
     */
    static void post(Context context, String channelId, String channelName, String channelDesc, int notifId,
                     String title, String body, String target, String itemId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(channelDesc);
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            DebugLog.log(context, "notify", "skipped: POST_NOTIFICATIONS not granted");
            return;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(context, notifId, MainActivity.openIntent(context, target, itemId),
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        int iconRes = R.drawable.ic_stat_notify; // 상태 표시줄용 흑백 아이콘 (컬러 앱 아이콘은 흰 동그라미로 보임)
        try {
            nm.notify(notifId, new NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(iconRes)
                    .setColor(0xFF5C088C) // 앱 보라색
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .setContentIntent(contentIntent)
                    .build());
        } catch (Exception e) {
            DebugLog.log(context, "notify", "failed: " + e.getMessage());
        }
    }
}
