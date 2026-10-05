package kr.ac.hs.lmsnotifier;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import kr.ac.hs.lmsnotifier.TodoListParser.TodoItem;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BackgroundSyncWorker extends Worker {
    private static final String TAG = "BackgroundSyncWorker";

    public static final String PREFS_NAME = "hs_lms_background_sync";
    public static final String PREF_LAST_SYNC_TIME = "last_sync_time";
    public static final String PREF_LAST_STATUS = "last_status";
    public static final String PREF_ITEMS_COUNT = "items_count";
    public static final String PREF_SEEN_ITEM_IDS = "seen_item_ids";
    public static final String PREF_HAS_SEEDED = "has_seeded";
    public static final String PREF_ENABLED = "enabled";
    public static final String PREF_INTERVAL_MINUTES = "interval_minutes";
    // 과목 공지(완료 목록의 tab9)를 처음 확인했는지. 처음 회차는 기존 공지를 기록만 하고 알리지 않음
    public static final String PREF_NOTICES_SEEDED = "notices_seeded";
    // 앱 알림 설정 (BackgroundSyncPlugin.setNotificationPrefs): 푸시 전체 / 새 과제·강의·퀴즈 / 새 공지
    public static final String PREF_NOTIFY_PUSH = "notify_push";
    public static final String PREF_NOTIFY_ITEMS = "notify_items";
    public static final String PREF_NOTIFY_NOTICES = "notify_notices";
    // Capacitor는 앱 시작/종료 시 세션 쿠키를 삭제하므로 LMS 세션 쿠키 사본을 별도 보관
    public static final String PREF_SESSION_COOKIE = "lms_session_cookie";
    // 서버가 세션을 마지막으로 유효하다고 응답한 시각(epoch ms). 앱이 "다른 곳 로그인" 추정에 사용
    public static final String PREF_SESSION_OK_AT = "lms_session_ok_at";
    // 서버가 "다른 PC 에서 로그인 되었습니다" 응답을 준 시각(epoch ms). 끊긴 세션의 첫 요청에만 오는 1회성 응답
    public static final String PREF_SESSION_KICKED_AT = "lms_session_kicked_at";
    // "다른 PC" 응답 없이 세션 만료(302·로그인 필요)를 본 시각(epoch ms). 앱이 자연 만료로 보고 재로그인해도 되는지 판단
    public static final String PREF_SESSION_EXPIRED_AT = "lms_session_expired_at";
    // 안내 페이지: 짧은 응답 + alert('…PC…'); top.location=... (EUC-KR이라 한글은 깨질 수 있어 ASCII 구조로 판별)
    // 일반 페이지 본문에 "다른 PC에서 로그인" 문장이 있어도 걸리지 않게 구조와 길이를 함께 본다 (sessionGuard.ts와 같은 규칙)
    private static final Pattern KICKED_PAGE_PATTERN =
            Pattern.compile("alert\\(\\s*['\"][^'\"]*PC[^'\"]*['\"]\\s*\\)\\s*;?\\s*top\\.location\\s*=");
    private static final int KICKED_PAGE_MAX_LEN = 2000;

    static boolean isKickedResponse(String html) {
        return html != null && html.length() <= KICKED_PAGE_MAX_LEN && KICKED_PAGE_PATTERN.matcher(html).find();
    }

    public static final String CHANNEL_ID = "lms_background_sync";
    public static final String CHANNEL_NAME = "LMS 백그라운드 알림";

    // 백그라운드 확인이 멈췄을 때(다른 곳 로그인·로그인 만료) 한 번 알리는 알림. 다시 로그인하면 사라짐
    public static final String STATUS_CHANNEL_ID = "lms_sync_status";
    public static final String STATUS_CHANNEL_NAME = "동기화 상태";
    public static final int SYNC_STOPPED_NOTIFICATION_ID = 7301;
    // 멈춤 알림을 이미 보냈는지 (같은 멈춤에 대해 반복해서 알리지 않음)
    public static final String PREF_STOP_NOTIFIED = "sync_stop_notified";

    static final String LMS_BASE = "https://lms.hs.ac.kr";
    private static final String TODO_URL = LMS_BASE + "/lms/myLecture/doTodoList.dunet";
    // 서버가 Referer의 메뉴 ID(mnid)를 요구함: 빠지면 HTTP 500 (lmsScraper.ts의 MY_LECTURE_MNID와 동일, HAR 확인)
    private static final String MENU_URL = LMS_BASE + "/lms/myLecture/doListView.dunet?mnid=201008840728";
    private static final String TODO_REFERER = MENU_URL;
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    // 디버그 빌드 전용 테스트 모드: 15분 미만 주기는 PeriodicWork로 불가능하므로 OneTimeWork를 이어서 예약
    public static final String TEST_WORK_NAME = "lms_background_sync_test_work";
    public static final int MIN_PERIODIC_MINUTES = 15;

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** 디버그 빌드에서 15분 미만 주기를 선택했는지 */
    public static boolean isTestInterval(Context context, int intervalMinutes) {
        return DebugLog.isDebugBuild(context) && intervalMinutes > 0 && intervalMinutes < MIN_PERIODIC_MINUTES;
    }

    /** 테스트 모드 다음 실행 예약 (policy: 설정 변경 시 REPLACE, 워커 자신이 이어 붙일 때 APPEND_OR_REPLACE) */
    public static void scheduleTestRun(Context context, int delayMinutes, ExistingWorkPolicy policy) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(BackgroundSyncWorker.class)
                .setInitialDelay(delayMinutes, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(TEST_WORK_NAME, policy, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        Result result = runSync();
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int interval = prefs.getInt(PREF_INTERVAL_MINUTES, 30);
        if (prefs.getBoolean(PREF_ENABLED, true) && isTestInterval(context, interval)) {
            // 실행 중인 자기 자신을 취소하지 않도록 APPEND_OR_REPLACE로 다음 실행을 이어 붙임
            scheduleTestRun(context, interval, ExistingWorkPolicy.APPEND_OR_REPLACE);
            DebugLog.log(context, "worker", "test mode: next run in " + interval + "min");
        }
        return result;
    }

    private Result runSync() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        boolean enabled = prefs.getBoolean(PREF_ENABLED, true);
        DebugLog.log(context, "worker", "doWork start (enabled=" + enabled + ", attempt=" + getRunAttemptCount() + ")");
        if (!enabled) {
            Log.d(TAG, "Background sync is disabled in settings. Skipping.");
            return Result.success();
        }

        // 1. Android CookieManager에서 LMS 세션 쿠키(JSESSIONID) 추출
        CookieManager cookieManager = CookieManager.getInstance();
        String cookie = cookieManager.getCookie(LMS_BASE);
        String cookieSource = "CookieManager";
        if (cookie == null || !cookie.contains("JSESSIONID")) {
            String altCookie = cookieManager.getCookie(LMS_BASE + "/");
            if (altCookie != null && altCookie.contains("JSESSIONID")) {
                cookie = altCookie;
            }
        }
        if (cookie == null || !cookie.contains("JSESSIONID")) {
            String altCookie = cookieManager.getCookie("http://lms.hs.ac.kr");
            if (altCookie != null && altCookie.contains("JSESSIONID")) {
                cookie = altCookie;
            }
        }
        if (cookie == null || !cookie.contains("JSESSIONID")) {
            // 앱 종료 시 CookieManager의 세션 쿠키가 삭제되므로 보관해 둔 사본 사용
            String savedCookie = prefs.getString(PREF_SESSION_COOKIE, null);
            if (savedCookie != null && savedCookie.contains("JSESSIONID")) {
                cookie = savedCookie;
                cookieSource = "saved copy";
            }
        }
        // 쿠키 값은 기록하지 않고 출처/존재 여부만 기록
        DebugLog.log(context, "worker", "session cookie: "
                + (cookie != null && cookie.contains("JSESSIONID") ? "found via " + cookieSource : "none"));

        // 세션 쿠키가 없으면 PC 세션 보호를 위해 절대 재로그인하지 않고 조용히 종료
        if (cookie == null || !cookie.contains("JSESSIONID")) {
            Log.d(TAG, "No active LMS session cookie found. Exiting silently.");
            updateStatus(context, "로그인 세션 없음 (앱 실행 필요)", 0);
            return Result.success();
        }

        // 2. doTodoList.dunet 단 1회 POST 호출 (to_do_type=proceedable)
        //    proceedable: 기간 내 미완료 / incomplete: 기한이 지난 미완료 / complete: 완료
        String html;
        int httpCode;
        try {
            // 2-1. "내 강의" 메뉴 진입: 브라우저·앱과 같은 순서. 메뉴를 거치지 않고 doTodoList만 부르면
            //      세션이 정상이어도 "잘못된 경로입니다" HTTP 500 (기기 로그 2026-10-05 확인)
            HttpResult menu = send(context, "GET", MENU_URL, LMS_BASE + "/main/MainView.dunet", cookie, null);
            DebugLog.log(context, "worker", "doListView(menu) HTTP " + menu.code);
            if (menu.code == 301 || menu.code == 302) {
                markExpired(prefs);
                notifySyncStopped(context, prefs);
                updateStatus(context, "세션 만료 (앱 실행 시 자동 갱신)", 0);
                return Result.success();
            }
            if (isKickedResponse(menu.body) || menu.code >= 400) {
                // 아래 3-1 / 3-2에서 같은 방식으로 기록
                html = menu.body;
                httpCode = menu.code;
            } else {
                if (menu.refreshedCookie != null) cookie = menu.refreshedCookie;

                // 2-2. 할 일 목록
                HttpResult todo = send(context, "POST", TODO_URL, TODO_REFERER, cookie, "to_do_type=proceedable");
                DebugLog.log(context, "worker", "doTodoList(proceedable) HTTP " + todo.code);
                if (todo.code == 301 || todo.code == 302) {
                    Log.d(TAG, "LMS session redirected (HTTP " + todo.code + "). Exiting silently to protect PC session.");
                    markExpired(prefs);
                    notifySyncStopped(context, prefs);
                    updateStatus(context, "세션 만료 (앱 실행 시 자동 갱신)", 0);
                    return Result.success();
                }
                html = todo.body;
                httpCode = todo.code;
            }
        } catch (Exception e) {
            Log.w(TAG, "Network error during background sync: " + e.getMessage());
            DebugLog.log(context, "worker", "network error: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            updateStatus(context, "네트워크 오류 (재시도 대기)", 0);
            return Result.success();
        }

        // 3-1. 다른 곳(PC)의 로그인으로 세션이 끊김: 앱이 재로그인하지 않도록 기록하고 종료
        if (isKickedResponse(html)) {
            DebugLog.log(context, "worker", "server says: logged in from another PC");
            prefs.edit().putLong(PREF_SESSION_KICKED_AT, System.currentTimeMillis()).apply();
            notifySyncStopped(context, prefs);
            updateStatus(context, "다른 PC 로그인 감지 (동기화 멈춤)", 0);
            return Result.success();
        }

        // 3-2. 서버 오류: 세션 만료가 아니므로 따로 기록 (원인 확인용으로 태그를 걷어낸 응답 앞부분만)
        if (httpCode >= 400) {
            String head = html.replaceAll("(?s)<script.*?</script>|<style.*?</style>", " ")
                    .replaceAll("<[^>]+>", " ")
                    .replaceAll("\\s+", " ")
                    .trim();
            if (head.length() > 200) head = head.substring(0, 200);
            DebugLog.log(context, "worker", "server error HTTP " + httpCode + ": " + head);
            updateStatus(context, "서버 오류 (HTTP " + httpCode + ")", 0);
            return Result.success();
        }

        // 3. 세션 만료 및 로그인 리디렉션 검증: todolist_pop이 없으면 무음 종료
        if (!html.contains("todolist_pop") || html.contains("sso2.hs.ac.kr") || html.contains("로그인이 필요합니다")) {
            Log.d(TAG, "LMS session expired on server. Exiting silently without re-auth to protect PC session.");
            DebugLog.log(context, "worker", "session invalid: todolist_pop=" + html.contains("todolist_pop")
                    + " ssoRedirect=" + html.contains("sso2.hs.ac.kr")
                    + " loginRequired=" + html.contains("로그인이 필요합니다")
                    + " htmlLen=" + html.length());
            markExpired(prefs);
            notifySyncStopped(context, prefs);
            updateStatus(context, "세션 만료 (앱 실행 시 자동 갱신)", 0);
            return Result.success();
        }

        prefs.edit().putLong(PREF_SESSION_OK_AT, System.currentTimeMillis()).apply();
        clearSyncStopped(context, prefs);
        long now = System.currentTimeMillis();

        // 4. 할일 목록 파싱: 과제(tab5), 온라인 인강(tab2), 퀴즈/시험(tab7, tab8)
        // 항목 ID는 앱(lmsScraper.ts)과 같아야 함 → TodoListParser 참고
        List<TodoItem> parsedItems = TodoListParser.parse(html, now);
        DebugLog.log(context, "worker", "parsed " + parsedItems.size() + " items (html " + html.length() + " chars)");
        List<TodoItem> pendingItems = new ArrayList<>();
        for (TodoItem item : parsedItems) {
            if (item.isPending && !"tab9".equals(item.tab)) {
                pendingItems.add(item);
            }
        }

        // 4-1. 완료 목록(complete): 과목 공지(tab9)는 이 목록에만 오고, 제출·수강을 마친 항목의 마감 알림을 지우는 데 씀
        //      실패해도 할 일 확인은 그대로 진행 (공지·완료 반영만 이번 회차에서 건너뜀)
        List<TodoItem> completeItems = null;
        try {
            HttpResult complete = send(context, "POST", TODO_URL, TODO_REFERER, cookie, "to_do_type=complete");
            DebugLog.log(context, "worker", "doTodoList(complete) HTTP " + complete.code);
            if (isKickedResponse(complete.body)) {
                // 두 요청 사이에 다른 곳 로그인으로 끊김: 1회성 안내라 여기서 기록하지 않으면 다음 회차에 자연 만료로 오인
                DebugLog.log(context, "worker", "server says: logged in from another PC (complete list)");
                prefs.edit().putLong(PREF_SESSION_KICKED_AT, System.currentTimeMillis()).apply();
                notifySyncStopped(context, prefs);
            } else if (complete.code == 200 && complete.body.contains("todolist_pop")) {
                completeItems = TodoListParser.parse(complete.body, now);
            }
        } catch (Exception e) {
            DebugLog.log(context, "worker", "complete list skipped: " + e.getClass().getSimpleName());
        }

        boolean pushOn = prefs.getBoolean(PREF_NOTIFY_PUSH, true);
        boolean itemAlertOn = pushOn && prefs.getBoolean(PREF_NOTIFY_ITEMS, true);
        boolean noticeAlertOn = pushOn && prefs.getBoolean(PREF_NOTIFY_NOTICES, true);

        // 5. SharedPreferences의 seen ID 추적 및 알림 발송 (알림을 꺼 둬도 본 것으로 기록해 나중에 켰을 때 몰아서 오지 않게)
        boolean hasSeeded = prefs.getBoolean(PREF_HAS_SEEDED, false);
        Set<String> seenIds = prefs.getStringSet(PREF_SEEN_ITEM_IDS, null);
        seenIds = seenIds != null ? new HashSet<>(seenIds) : new HashSet<>();

        List<TodoItem> newItems = new ArrayList<>();
        for (TodoItem item : pendingItems) {
            if (!seenIds.contains(item.id)) {
                newItems.add(item);
            }
        }

        if (!hasSeeded) {
            // 첫 번째 백그라운드 실행: 알림 폭탄 방지를 위해 기존 미완료 항목 ID 시딩만 수행
            for (TodoItem item : pendingItems) {
                seenIds.add(item.id);
            }
            prefs.edit().putBoolean(PREF_HAS_SEEDED, true).apply();
            Log.i(TAG, "First background run: seeded " + pendingItems.size() + " items without notification.");
            DebugLog.log(context, "worker", "first run: seeded " + pendingItems.size() + " items (no notification)");
        } else if (!newItems.isEmpty()) {
            // 이후 실행: 신규 발견된 미완료 할일에 대해서만 알림 발송
            if (itemAlertOn) sendNotification(context, newItems);
            for (TodoItem item : newItems) {
                seenIds.add(item.id);
            }
            StringBuilder ids = new StringBuilder();
            for (TodoItem item : newItems) ids.append(item.id).append(", ");
            DebugLog.log(context, "worker", (itemAlertOn ? "notified " : "seen (alert off) ") + newItems.size() + " new items: " + ids);
        }

        // 5-1. 새 과목 공지 (완료 목록의 tab9). 공지를 처음 확인하는 회차(업데이트 직후 포함)는 기록만 하고 알리지 않음
        if (completeItems != null) {
            List<TodoItem> notices = new ArrayList<>();
            for (TodoItem item : completeItems) {
                if ("tab9".equals(item.tab)) notices.add(item);
            }
            boolean noticesSeeded = prefs.getBoolean(PREF_NOTICES_SEEDED, false);
            List<TodoItem> newNotices = new ArrayList<>();
            for (TodoItem n : notices) {
                if (!seenIds.contains(n.id)) newNotices.add(n);
                seenIds.add(n.id);
            }
            if (!noticesSeeded) {
                prefs.edit().putBoolean(PREF_NOTICES_SEEDED, true).apply();
                DebugLog.log(context, "worker", "notices first run: seeded " + notices.size());
            } else if (!newNotices.isEmpty()) {
                if (noticeAlertOn) sendNoticeNotification(context, newNotices);
                DebugLog.log(context, "worker", (noticeAlertOn ? "notified " : "seen (alert off) ") + newNotices.size() + " new notices");
            }
        }
        prefs.edit().putStringSet(PREF_SEEN_ITEM_IDS, seenIds).apply();

        // 6. 마감 알림 갱신: 완료 목록에 오른 항목은 지우고, 처음 보는 진행 중 항목은 예약 (앱을 열지 않아도 맞춰짐)
        Set<String> completedIds = new HashSet<>();
        if (completeItems != null) {
            for (TodoItem item : completeItems) {
                if (!"tab9".equals(item.tab)) completedIds.add(item.id);
            }
        }
        DeadlineReminders.applyWorkerResult(context, pendingItems, completedIds, now);

        String statusMsg = pendingItems.isEmpty()
                ? "정상 동기화됨 (미완료 항목 없음)"
                : "정상 동기화됨 (미완료 " + pendingItems.size() + "건)";
        updateStatus(context, statusMsg, pendingItems.size());

        return Result.success();
    }

    /**
     * 백그라운드 확인이 멈췄음을 한 번 알림 (같은 멈춤에는 다시 알리지 않음).
     * 마지막 정상 이후 "다른 PC 에서 로그인"을 받았으면(앱이 받은 경우 포함) 그 이유로, 아니면 로그인 만료로 안내.
     */
    private void notifySyncStopped(Context context, SharedPreferences prefs) {
        if (prefs.getBoolean(PREF_STOP_NOTIFIED, false)) return;
        long okAt = prefs.getLong(PREF_SESSION_OK_AT, 0L);
        long kickedAt = prefs.getLong(PREF_SESSION_KICKED_AT, 0L);
        boolean kicked = kickedAt > 0 && kickedAt >= okAt;

        String title = kicked ? "다른 곳에서 LMS에 로그인해서 확인을 멈췄어요" : "LMS 로그인이 만료돼 확인을 멈췄어요";
        String text = kicked
                ? "PC 쪽 로그인이 끊기지 않도록 새 과제 확인을 멈췄어요. 앱을 열어 다시 로그인하면 이어서 확인해요."
                : "새 과제·강의 확인이 멈췄어요. 앱을 한 번 열면 다시 로그인해서 이어서 확인해요.";

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    STATUS_CHANNEL_ID, STATUS_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("백그라운드 확인이 멈췄을 때 알려 줍니다");
            nm.createNotificationChannel(channel);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            DebugLog.log(context, "worker", "stop notification skipped: POST_NOTIFICATIONS not granted");
            return;
        }

        // 누르면 홈으로 (멈춤 안내와 "다시 로그인" 버튼이 있는 화면)
        Intent intent = MainActivity.openIntent(context, "home", null);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, SYNC_STOPPED_NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));
        int iconRes = R.drawable.ic_stat_notify; // 상태 표시줄용 흑백 아이콘 (컬러 앱 아이콘은 흰 동그라미로 보임)

        try {
            nm.notify(SYNC_STOPPED_NOTIFICATION_ID, new NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
                    .setSmallIcon(iconRes)
                    .setColor(0xFF5C088C) // 앱 보라색
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)
                    .build());
            prefs.edit().putBoolean(PREF_STOP_NOTIFIED, true).apply();
            DebugLog.log(context, "worker", "stop notification sent (kicked=" + kicked + ")");
        } catch (Exception ex) {
            DebugLog.log(context, "worker", "stop notification failed: " + ex.getMessage());
        }
    }

    /** 세션이 다시 정상 → 멈춤 알림을 지우고 다음 멈춤 때 다시 알릴 수 있게 함 (앱 로그인 시에는 플러그인 saveSession이 호출) */
    static void clearSyncStopped(Context context, SharedPreferences prefs) {
        if (!prefs.getBoolean(PREF_STOP_NOTIFIED, false)) return;
        prefs.edit().putBoolean(PREF_STOP_NOTIFIED, false).apply();
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(SYNC_STOPPED_NOTIFICATION_ID);
    }

    /** 끊긴 세션의 첫 요청은 "다른 PC" 응답을 받으므로, 그 응답 없이 본 만료는 자연 만료(유휴 만료·서버 재시작 등) */
    private static void markExpired(SharedPreferences prefs) {
        prefs.edit().putLong(PREF_SESSION_EXPIRED_AT, System.currentTimeMillis()).apply();
    }

    static class HttpResult {
        int code;
        String body = "";
        String refreshedCookie; // Set-Cookie로 갱신된 경우의 새 쿠키 문자열
    }

    /**
     * LMS 요청 1회 (리디렉션은 따라가지 않음: 302 = 세션 만료). Set-Cookie는 CookieManager와 보관 사본에 반영.
     */
    private HttpResult send(Context context, String method, String target, String referer, String cookie, String formBody)
            throws java.io.IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
        HttpResult result = new HttpResult();
        try {
            conn.setRequestMethod(method);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Cookie", cookie);
            conn.setRequestProperty("Referer", referer);
            if (formBody != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                conn.setRequestProperty("Origin", LMS_BASE);
                conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                conn.setRequestProperty("Accept", "*/*");
                byte[] body = formBody.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(body.length);
                OutputStream os = conn.getOutputStream();
                os.write(body);
                os.flush();
                os.close();
            }

            result.code = conn.getResponseCode();
            InputStream is = (result.code >= 200 && result.code < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is != null) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                reader.close();
                result.body = sb.toString();
            }

            List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
            if (setCookies != null && !setCookies.isEmpty()) {
                CookieManager cookieManager = CookieManager.getInstance();
                for (String sc : setCookies) {
                    cookieManager.setCookie(LMS_BASE, sc);
                }
                cookieManager.flush();
                String refreshed = cookieManager.getCookie(LMS_BASE);
                if (refreshed != null && refreshed.contains("JSESSIONID")) {
                    result.refreshedCookie = refreshed;
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .edit().putString(PREF_SESSION_COOKIE, refreshed).apply();
                }
            }
        } finally {
            conn.disconnect();
        }
        return result;
    }

    private void sendNotification(Context context, List<TodoItem> newItems) {
        String title;
        String contentText;
        TodoItem first = newItems.get(0);
        if (newItems.size() == 1) {
            String typeLabel = "할일";
            if ("tab5".equals(first.tab)) typeLabel = "과제";
            else if ("tab2".equals(first.tab)) typeLabel = "온라인 강의";
            else if ("tab7".equals(first.tab) || "tab8".equals(first.tab)) typeLabel = "퀴즈/시험";

            String coursePrefix = (first.courseNm != null && !first.courseNm.isEmpty()) ? "[" + first.courseNm + "] " : "";
            title = "📝 " + coursePrefix + "새 " + typeLabel + " 등록!";
            contentText = first.title + (first.dateStr.isEmpty() ? "" : " (기한: " + first.dateStr + ")");
        } else {
            title = "📝 LMS 새 학습활동 " + newItems.size() + "건 등록!";
            contentText = first.title + " 외 " + (newItems.size() - 1) + "건";
        }

        // 누르면 해당 목록으로 (한 건이면 그 항목을 바로 엶)
        boolean allLectures = true;
        for (TodoItem item : newItems) allLectures &= "tab2".equals(item.tab);
        String target = allLectures ? "lms:lectures" : "lms:assignments";
        String itemId = newItems.size() == 1 && !allLectures ? first.id : null;

        // 항목 ID 기반 결정론적 알림 ID (재실행 시 같은 항목 알림은 덮어쓰기)
        StringBuilder idSeed = new StringBuilder();
        for (TodoItem item : newItems) idSeed.append(item.id).append('|');
        int notifId = idSeed.toString().hashCode() & 0x7FFFFFFF;
        DeadlineReminders.post(context, CHANNEL_ID, CHANNEL_NAME, "한신대학교 LMS 백그라운드 할일 알림",
                notifId, title, contentText, target, itemId);
    }

    private void sendNoticeNotification(Context context, List<TodoItem> notices) {
        TodoItem first = notices.get(0);
        String title;
        String text;
        if (notices.size() == 1) {
            String coursePrefix = (first.courseNm != null && !first.courseNm.isEmpty()) ? "[" + first.courseNm + "] " : "";
            title = "📢 " + coursePrefix + "새 공지사항";
            text = first.title;
        } else {
            title = "📢 LMS 새 공지 " + notices.size() + "건";
            text = first.title + " 외 " + (notices.size() - 1) + "건";
        }
        StringBuilder idSeed = new StringBuilder("notice|");
        for (TodoItem n : notices) idSeed.append(n.id).append('|');
        DeadlineReminders.post(context, CHANNEL_ID, CHANNEL_NAME, "한신대학교 LMS 백그라운드 할일 알림",
                idSeed.toString().hashCode() & 0x7FFFFFFF, title, text, "lms:notices", notices.size() == 1 ? first.id : null);
    }

    private void updateStatus(Context context, String status, int itemsCount) {
        DebugLog.log(context, "worker", "result: " + status + " (pending=" + itemsCount + ")");
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA);
        String nowStr = sdf.format(new Date());

        prefs.edit()
                .putString(PREF_LAST_SYNC_TIME, nowStr)
                .putString(PREF_LAST_STATUS, status)
                .putInt(PREF_ITEMS_COUNT, itemsCount)
                .apply();
    }
}
