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
import androidx.work.Worker;
import androidx.work.WorkerParameters;
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

    public static final String CHANNEL_ID = "lms_background_sync";
    public static final String CHANNEL_NAME = "LMS 백그라운드 알림";

    static final String LMS_BASE = "https://lms.hs.ac.kr";
    private static final String TODO_URL = LMS_BASE + "/lms/myLecture/doTodoList.dunet";
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    public BackgroundSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static class TodoItem {
        public String id;
        public String tab; // tab5, tab2, tab7, tab8
        public String courseId;
        public String courseNm;
        public String title;
        public String dateStr;
        public boolean isPending;

        public TodoItem(String id, String tab, String courseId, String courseNm, String title, String dateStr, boolean isPending) {
            this.id = id;
            this.tab = tab;
            this.courseId = courseId;
            this.courseNm = courseNm;
            this.title = title;
            this.dateStr = dateStr;
            this.isPending = isPending;
        }
    }

    @NonNull
    @Override
    public Result doWork() {
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
        try {
            URL url = new URL(TODO_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Cookie", cookie);
            conn.setRequestProperty("Origin", LMS_BASE);
            conn.setRequestProperty("Referer", LMS_BASE + "/lms/myLecture/doListView.dunet");

            byte[] body = "to_do_type=proceedable".getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            DebugLog.log(context, "worker", "doTodoList(proceedable) HTTP " + code);
            if (code == 301 || code == 302) {
                Log.d(TAG, "LMS session redirected (HTTP " + code + "). Exiting silently to protect PC session.");
                updateStatus(context, "세션 만료 (앱 실행 시 자동 갱신)", 0);
                conn.disconnect();
                return Result.success();
            }

            InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) {
                updateStatus(context, "네트워크 응답 오류 (HTTP " + code + ")", 0);
                return Result.success();
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();

            // Set-Cookie 갱신이 있으면 CookieManager에 동기화
            List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
            if (setCookies != null) {
                for (String sc : setCookies) {
                    cookieManager.setCookie(LMS_BASE, sc);
                }
                cookieManager.flush();
                String refreshed = cookieManager.getCookie(LMS_BASE);
                if (refreshed != null && refreshed.contains("JSESSIONID")) {
                    prefs.edit().putString(PREF_SESSION_COOKIE, refreshed).apply();
                }
            }

            conn.disconnect();
            html = sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "Network error during background sync: " + e.getMessage());
            updateStatus(context, "네트워크 오류 (재시도 대기)", 0);
            return Result.success();
        }

        // 3. 세션 만료 및 로그인 리디렉션 검증: todolist_pop이 없으면 무음 종료
        if (!html.contains("todolist_pop") || html.contains("sso2.hs.ac.kr") || html.contains("로그인이 필요합니다")) {
            Log.d(TAG, "LMS session expired on server. Exiting silently without re-auth to protect PC session.");
            updateStatus(context, "세션 만료 (앱 실행 시 자동 갱신)", 0);
            return Result.success();
        }

        // 4. 할일 목록 파싱: 과제(tab5), 온라인 인강(tab2), 퀴즈/시험(tab7, tab8)
        List<TodoItem> parsedItems = parseTodoList(html);
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

    private List<TodoItem> parseTodoList(String html) {
        List<TodoItem> items = new ArrayList<>();
        if (html == null || html.isEmpty()) return items;

        Pattern liPattern = Pattern.compile("<li[^>]*class=[\"'][^\"']*\\b(tab\\d+)\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</li>", Pattern.CASE_INSENSITIVE);
        Matcher liMatcher = liPattern.matcher(html);

        Pattern fnPattern = Pattern.compile("fnGoContent\\s*\\(([^)]+)\\)");
        Pattern subjPattern = Pattern.compile("<(?:span|div)[^>]*class=[\"'][^\"']*\\bsubject\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</(?:span|div)>", Pattern.CASE_INSENSITIVE);
        Pattern lecPattern = Pattern.compile("<(?:span|div)[^>]*class=[\"'][^\"']*\\blec_name\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</(?:span|div)>", Pattern.CASE_INSENSITIVE);
        Pattern datePattern = Pattern.compile("<div[^>]*class=[\"'][^\"']*\\bdate\\b[^\"']*[\"'][^>]*>[\\s\\S]*?<span[^>]*>([\\s\\S]*?)</span>", Pattern.CASE_INSENSITIVE);

        long now = System.currentTimeMillis();

        while (liMatcher.find()) {
            String tabClass = liMatcher.group(1).toLowerCase(Locale.ROOT);
            String liContent = liMatcher.group(2);

            if (!tabClass.equals("tab5") && !tabClass.equals("tab2") && !tabClass.equals("tab7") && !tabClass.equals("tab8")) {
                continue;
            }

            String courseId = "";
            String classNo = "";
            String contentId = "";
            Matcher fnMatcher = fnPattern.matcher(liContent);
            if (fnMatcher.find()) {
                String[] args = fnMatcher.group(1).split(",");
                if (args.length > 1) courseId = cleanArg(args[1]);
                if (args.length > 2) classNo = cleanArg(args[2]);
                if (args.length > 3) contentId = cleanArg(args[3]);
            }

            Matcher subjMatcher = subjPattern.matcher(liContent);
            String rawSubject = subjMatcher.find() ? subjMatcher.group(1) : "";
            String title = cleanHtmlText(rawSubject)
                    .replaceAll("\\s*(?:새로운\\s+|새\\s+)?글이 등록되었습니다\\.?", "")
                    .trim();

            if (title.isEmpty()) continue;

            Matcher lecMatcher = lecPattern.matcher(liContent);
            String rawLec = lecMatcher.find() ? lecMatcher.group(1) : "";
            String courseNm = cleanLecName(rawLec);

            Matcher dateMatcher = datePattern.matcher(liContent);
            String dateStr = dateMatcher.find() ? cleanHtmlText(dateMatcher.group(1)) : "";

            String id;
            boolean isPending = true;

            if (tabClass.equals("tab5")) {
                id = courseId + "_assignment_" + (contentId.isEmpty() ? title : contentId);
                long deadline = parseDeadlineMs(dateStr);
                if (deadline < now) {
                    isPending = false; // 이미 마감 지난 과제는 알림 대상 제외
                }
            } else if (tabClass.equals("tab2")) {
                // 진도율 "(NN%)"이 바뀌어도 동일 강의로 인식되도록 ID에서 제외
                id = courseId + "_lecture_" + stripProgress(title);
                if (title.contains("100%")) {
                    isPending = false; // 진도 100% 완료 강의 제외
                }
                long deadline = parseDeadlineMs(dateStr);
                if (deadline < now) {
                    isPending = false; // 수강 기간 만료 강의 제외
                }
            } else { // tab7, tab8: 퀴즈 및 시험
                id = courseId + "_quiz_" + (contentId.isEmpty() ? title : contentId);
                long deadline = parseDeadlineMs(dateStr);
                if (deadline < now) {
                    isPending = false; // 이미 종료된 퀴즈/시험 제외
                }
            }

            items.add(new TodoItem(id, tabClass, courseId, courseNm, title, dateStr, isPending));
        }

        return items;
    }

    static String stripProgress(String title) {
        if (title == null) return "";
        return title.replaceAll("\\s*\\(\\d{1,3}%\\)\\s*$", "").trim();
    }

    private static String cleanLecName(String text) {
        if (text == null) return "";
        return cleanHtmlText(text)
                .replaceAll("^[\\(\\[]\\d{2,4}[^\\]\\)]*[\\]\\)]\\s*", "")
                .replaceAll("^\\[", "")
                .replaceAll("\\]$", "")
                .trim();
    }

    private static String cleanArg(String s) {
        if (s == null) return "";
        return s.trim().replaceAll("^['\"]|['\"]$", "").trim();
    }

    private static String cleanHtmlText(String text) {
        if (text == null) return "";
        String cleaned = text.replaceAll("<[^>]+>", " ");
        cleaned = cleaned.replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&nbsp;", " ");
        return cleaned.trim().replaceAll("\\s+", " ");
    }

    private static long parseDeadlineMs(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) return Long.MAX_VALUE;
        Pattern p = Pattern.compile("(\\d{4})[.\\-/](\\d{2})[.\\-/](\\d{2})(?:\\s+(\\d{2}):(\\d{2})(?::(\\d{2}))?)?");
        Matcher m = p.matcher(dateStr);
        long lastMs = Long.MAX_VALUE;
        while (m.find()) {
            try {
                int y = Integer.parseInt(m.group(1));
                int mon = Integer.parseInt(m.group(2)) - 1;
                int d = Integer.parseInt(m.group(3));
                int h = m.group(4) != null ? Integer.parseInt(m.group(4)) : 23;
                int min = m.group(5) != null ? Integer.parseInt(m.group(5)) : 59;
                int s = m.group(6) != null ? Integer.parseInt(m.group(6)) : 59;
                Calendar cal = Calendar.getInstance();
                cal.set(y, mon, d, h, min, s);
                cal.set(Calendar.MILLISECOND, 0);
                lastMs = cal.getTimeInMillis();
            } catch (Exception ignored) {
            }
        }
        return lastMs;
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
