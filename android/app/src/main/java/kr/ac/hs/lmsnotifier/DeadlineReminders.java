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
import java.util.HashSet;
import java.util.List;
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

    /** 앱 동기화 결과로 목록 전체를 교체 (앱이 제출·수강 여부를 가장 정확히 앎) */
    static synchronized void replaceAll(Context context, List<Item> items, boolean enabled, boolean d1, boolean h3) {
        prefs(context).edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putBoolean(KEY_D1, d1)
                .putBoolean(KEY_H3, h3)
                .apply();
        save(context, items);
        reschedule(context);
        DebugLog.log(context, "reminder", "replaceAll items=" + items.size() + " enabled=" + enabled + " d1=" + d1 + " h3=" + h3);
    }

    /**
     * 백그라운드 확인 결과 반영: 완료 목록에 오른 항목(제출·수강 완료)은 알림을 지우고,
     * 진행 중 목록에서 처음 보는 항목은 알림을 새로 예약한다.
     */
    static synchronized void applyWorkerResult(Context context, List<TodoItem> pending, Set<String> completedIds, long now) {
        List<Item> items = load(context);
        Set<String> known = new HashSet<>();
        int removed = 0;
        List<Item> next = new ArrayList<>();
        for (Item it : items) {
            if (completedIds.contains(it.id)) {
                removed++;
                continue;
            }
            next.add(it);
            known.add(it.id);
        }
        int added = 0;
        for (TodoItem t : pending) {
            if (!t.isPending || known.contains(t.id)) continue;
            String kind = kindOfTab(t.tab);
            if (kind == null) continue;
            long deadline = TodoListParser.parseDeadlineMs(t.dateStr);
            if (deadline == Long.MAX_VALUE || deadline <= now) continue;
            Item it = new Item();
            it.id = t.id;
            it.kind = kind;
            it.courseNm = t.courseNm;
            it.title = KIND_LECTURE.equals(kind) ? TodoListParser.stripProgress(t.title) : t.title;
            it.deadlineStr = t.dateStr;
            it.deadlineMs = deadline;
            next.add(it);
            known.add(it.id);
            added++;
        }
        if (removed > 0 || added > 0) save(context, next);
        // 바뀐 것이 없어도 다시 예약: 강제 종료·정확한 알람 권한 해제 때 시스템이 알람을 지우므로 확인할 때마다 복구
        reschedule(context);
        DebugLog.log(context, "reminder", "worker result: +" + added + " -" + removed + " (total " + next.size() + ")");
    }

    static String kindOfTab(String tab) {
        if ("tab5".equals(tab)) return KIND_ASSIGNMENT;
        if ("tab7".equals(tab) || "tab8".equals(tab)) return KIND_QUIZ;
        if ("tab2".equals(tab)) return KIND_LECTURE;
        return null;
    }

    /** 로그아웃: 목록과 예약을 모두 지움 */
    static synchronized void clear(Context context) {
        save(context, new ArrayList<>());
        reschedule(context);
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
        if (enabled) {
            for (Item it : load(context)) {
                if (p.getBoolean(KEY_D1, true)) schedule(context, am, it, SLOT_D1, it.deadlineMs - DAY_MS, now, scheduled);
                if (p.getBoolean(KEY_H3, true)) schedule(context, am, it, SLOT_H3, it.deadlineMs - H3_MS, now, scheduled);
            }
        }
        p.edit().putStringSet(KEY_SCHEDULED, scheduled).apply();
        DeadlineWidgetProvider.refreshAll(context);
    }

    private static void schedule(Context context, AlarmManager am, Item it, String slot, long at, long now, Set<String> scheduled) {
        if (at <= now) return;
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
        } catch (SecurityException e) {
            DebugLog.log(context, "reminder", "schedule failed: " + e.getMessage());
        }
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
        String target = lecture ? "lms:lectures" : "lms:assignments";
        post(context, CHANNEL_ID, CHANNEL_NAME, "과제·퀴즈·온라인 강의 마감 전 알림", notifId, title, body, target, itemId);
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
