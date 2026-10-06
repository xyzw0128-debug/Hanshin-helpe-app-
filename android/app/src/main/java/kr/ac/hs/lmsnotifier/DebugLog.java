package kr.ac.hs.lmsnotifier;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 파일 로그 (앱 내부 저장소 files/debug_log.txt)
 * 앱이 종료된 상태에서 실행되는 백그라운드 워커의 동작도 남기기 위해 파일에 기록한다.
 * - 디버그 빌드: 항상 기록
 * - 배포(릴리스) 빌드: 기본 꺼짐. 앱 정보 화면의 숨김 메뉴에서 "문제 신고용 로그"를 켰을 때만 기록
 */
public final class DebugLog {
    private static final String TAG = "LmsDebugLog";
    private static final String FILE_NAME = "debug_log.txt";
    private static final long MAX_BYTES = 256 * 1024;

    private static final String PREFS_NAME = "hs_lms_debug_log";
    private static final String PREF_REPORT_ENABLED = "report_log_enabled";

    private DebugLog() {}

    /** 디버그 빌드인지 (1분 테스트 주기 등 개발용 기능은 이 값으로만 판단) */
    public static boolean isDebugBuild(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** 지금 로그를 기록하는지: 디버그 빌드이거나, 배포 앱에서 문제 신고용 로그를 켠 경우 */
    public static boolean isEnabled(Context context) {
        if (isDebugBuild(context)) return true;
        return prefs(context).getBoolean(PREF_REPORT_ENABLED, false);
    }

    /** 배포 앱의 문제 신고용 로그 켜기/끄기 */
    public static void setReportEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_REPORT_ENABLED, enabled).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * 지금 쓰는 네트워크 (예: "wifi/104", "cell/105"). 뒤의 번호는 연결마다 새로 붙으므로,
     * 번호가 바뀌었으면 Wi-Fi↔LTE 전환이나 재연결로 인터넷 주소가 바뀌었을 수 있다 ("다른 PC 로그인" 원인 확인용)
     */
    public static String network(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "?";
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                NetworkInfo info = cm.getActiveNetworkInfo();
                return info == null ? "none" : info.getTypeName().toLowerCase(Locale.ROOT);
            }
            Network active = cm.getActiveNetwork();
            if (active == null) return "none";
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            String type = "other";
            if (caps != null) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) type = "vpn";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "cell";
            }
            return type + "/" + active;
        } catch (Exception e) {
            return "?";
        }
    }

    /** 세션 쿠키를 구분하는 짧은 표식 (JSESSIONID의 SHA-256 앞 6자리, 값 자체는 남기지 않음). 같은 세션인지 비교용 */
    public static String sessionTag(String cookie) {
        if (cookie == null) return "none";
        Matcher m = JSESSIONID.matcher(cookie);
        if (!m.find()) return "none";
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(m.group(1).getBytes(StandardCharsets.UTF_8));
            return String.format(Locale.ROOT, "#%02x%02x%02x", hash[0], hash[1], hash[2]);
        } catch (Exception e) {
            return "#?";
        }
    }

    private static final Pattern JSESSIONID = Pattern.compile("JSESSIONID=([^;\\s]+)");

    public static synchronized void log(Context context, String source, String message) {
        if (context == null || !isEnabled(context)) return;
        String time = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.KOREA).format(new Date());
        String line = time + " [native:" + source + "] " + message + "\n";
        Log.d(TAG, line.trim());
        try {
            File file = new File(context.getFilesDir(), FILE_NAME);
            if (file.exists() && file.length() > MAX_BYTES) {
                trimToHalf(file);
            }
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(line.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to write debug log: " + e.getMessage());
        }
    }

    public static synchronized String read(Context context) {
        if (context == null) return "";
        File file = new File(context.getFilesDir(), FILE_NAME);
        if (!file.exists()) return "";
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            byte[] buf = new byte[(int) raf.length()];
            raf.readFully(buf);
            return new String(buf, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "(native log read failed: " + e.getMessage() + ")";
        }
    }

    public static synchronized void clear(Context context) {
        if (context == null) return;
        File file = new File(context.getFilesDir(), FILE_NAME);
        if (file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static void trimToHalf(File file) throws Exception {
        byte[] tail;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            long keep = raf.length() / 2;
            raf.seek(raf.length() - keep);
            tail = new byte[(int) keep];
            raf.readFully(tail);
        }
        // 잘린 첫 줄은 버리고 줄 단위로 시작
        int start = 0;
        while (start < tail.length && tail[start] != '\n') start++;
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            out.write(tail, Math.min(start + 1, tail.length), Math.max(0, tail.length - start - 1));
        }
    }
}
