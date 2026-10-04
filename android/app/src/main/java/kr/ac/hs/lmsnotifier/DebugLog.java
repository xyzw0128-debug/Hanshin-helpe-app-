package kr.ac.hs.lmsnotifier;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 디버그 빌드 전용 파일 로그 (앱 내부 저장소 files/debug_log.txt)
 * 앱이 종료된 상태에서 실행되는 백그라운드 워커의 동작도 남기기 위해 파일에 기록한다.
 * 릴리스 빌드(debuggable=false)에서는 아무것도 기록하지 않는다.
 */
public final class DebugLog {
    private static final String TAG = "LmsDebugLog";
    private static final String FILE_NAME = "debug_log.txt";
    private static final long MAX_BYTES = 256 * 1024;

    private DebugLog() {}

    public static boolean isEnabled(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

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
        if (context == null || !isEnabled(context)) return "";
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
