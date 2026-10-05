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

        // 4. 할일 목록 파싱: 과제(tab5), 온라인 인강(tab2), 퀴즈/시험(tab7, tab8)
        // 항목 ID는 앱(lmsScraper.ts)과 같아야 함 → TodoListParser 참고
        List<TodoItem> parsedItems = TodoListParser.parse(html, System.currentTimeMillis());
        DebugLog.log(context, "worker", "parsed " + parsedItems.size() + " items (html " + html.length() + " chars)");
        List<TodoItem> pendingItems = new ArrayList<>();
        for (TodoItem item : parsedItems) {
            if (item.isPending) {
                pendingItems.add(item);
            }
        }

        // 5. SharedPreferences의 seen ID 추적 및 알림 발송
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
            prefs.edit()
                .putBoolean(PREF_HAS_SEEDED, true)
                .putStringSet(PREF_SEEN_ITEM_IDS, seenIds)
                .apply();
            Log.i(TAG, "First background run: seeded " + pendingItems.size() + " items without notification.");
            DebugLog.log(context, "worker", "first run: seeded " + pendingItems.size() + " items (no notification)");
        } else {
            // 이후 실행: 신규 발견된 미완료 할일에 대해서만 알림 발송
            if (!newItems.isEmpty()) {
                sendNotification(context, newItems);
                for (TodoItem item : newItems) {
                    seenIds.add(item.id);
                }
                prefs.edit()
                    .putStringSet(PREF_SEEN_ITEM_IDS, seenIds)
                    .apply();
                Log.i(TAG, "Notified " + newItems.size() + " new pending items.");
                StringBuilder ids = new StringBuilder();
                for (TodoItem item : newItems) ids.append(item.id).append(", ");
                DebugLog.log(context, "worker", "notified " + newItems.size() + " new items: " + ids);
            }
        }

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

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, SYNC_STOPPED_NOTIFICATION_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));
        int iconRes = context.getApplicationInfo().icon != 0 ? context.getApplicationInfo().icon : R.mipmap.ic_launcher;

        try {
            nm.notify(SYNC_STOPPED_NOTIFICATION_ID, new NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
                    .setSmallIcon(iconRes)
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
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // Android 8.0+ 알림 채널 등록
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("한신대학교 LMS 백그라운드 할일 알림");
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);
        }

        // Android 13+ (API 33+) POST_NOTIFICATIONS 권한 체크
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "POST_NOTIFICATIONS permission not granted. Cannot display notification.");
                DebugLog.log(context, "worker", "notification skipped: POST_NOTIFICATIONS not granted");
                return;
            }
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String title;
        String contentText;
        if (newItems.size() == 1) {
            TodoItem item = newItems.get(0);
            String typeLabel = "할일";
            if ("tab5".equals(item.tab)) typeLabel = "과제";
            else if ("tab2".equals(item.tab)) typeLabel = "온라인 강의";
            else if ("tab7".equals(item.tab) || "tab8".equals(item.tab)) typeLabel = "퀴즈/시험";

            String coursePrefix = (item.courseNm != null && !item.courseNm.isEmpty()) ? "[" + item.courseNm + "] " : "";
            title = "📝 " + coursePrefix + "새 " + typeLabel + " 등록!";
            contentText = item.title + (item.dateStr.isEmpty() ? "" : " (기한: " + item.dateStr + ")");
        } else {
            title = "📝 LMS 새 학습활동 " + newItems.size() + "건 등록!";
            TodoItem first = newItems.get(0);
            contentText = first.title + " 외 " + (newItems.size() - 1) + "건";
        }

        int iconRes = context.getApplicationInfo().icon != 0 ? context.getApplicationInfo().icon : R.mipmap.ic_launcher;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(iconRes)
                .setContentTitle(title)
                .setContentText(contentText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(contentText))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        try {
            // 항목 ID 기반 결정론적 알림 ID (재실행 시 같은 항목 알림은 덮어쓰기)
            StringBuilder idSeed = new StringBuilder();
            for (TodoItem item : newItems) idSeed.append(item.id).append('|');
            int notifId = idSeed.toString().hashCode() & 0x7FFFFFFF;
            nm.notify(notifId, builder.build());
        } catch (Exception ex) {
            Log.w(TAG, "Failed to display notification: " + ex.getMessage());
            DebugLog.log(context, "worker", "notification failed: " + ex.getMessage());
        }
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
