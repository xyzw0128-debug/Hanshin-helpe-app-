package kr.ac.hs.lmsnotifier;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * doTodoList.dunet HTML 파서 (백그라운드 워커용, 안드로이드 API 의존 없음).
 *
 * 항목 ID는 앱(src/services/lmsScraper.ts parseTodoListHtml)과 반드시 같아야 한다.
 * ID가 다르면 앱이 이미 본 항목을 워커가 새 항목으로 보고 알림을 중복으로 보낸다.
 * 앱은 기기에서 DOMParser로 `li.querySelector('.subject').textContent`(중첩 태그 포함, 엔티티 전체 디코딩)를
 * 읽은 뒤 cleanText를 적용하므로, 여기서도 같은 값을 만든다. JS 정규식 \s와 trim()의 공백 범위도 맞춘다.
 * npm test의 Test 38이 두 파서의 ID 일치를 검증한다.
 */
public final class TodoListParser {
    private TodoListParser() {
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

    /** JS 정규식 \s 와 String.prototype.trim()이 공백으로 보는 문자 (Java \s는 ASCII 공백만 포함) */
    private static final String WS = "[\\t\\n\\u000B\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

    private static final Pattern LI_PATTERN = Pattern.compile("<li[^>]*class=[\"'][^\"']*\\b(tab\\d+)\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)</li>", Pattern.CASE_INSENSITIVE);
    private static final Pattern FN_PATTERN = Pattern.compile("fnGoContent\\s*\\(([^)]+)\\)");
    private static final Pattern DATE_PATTERN = Pattern.compile("<div[^>]*class=[\"'][^\"']*\\bdate\\b[^\"']*[\"'][^>]*>[\\s\\S]*?<span[^>]*>([\\s\\S]*?)</span>", Pattern.CASE_INSENSITIVE);
    private static final Pattern DEADLINE_PATTERN = Pattern.compile("(\\d{4})[.\\-/](\\d{2})[.\\-/](\\d{2})(?:\\s+(\\d{2}):(\\d{2})(?::(\\d{2}))?)?");
    private static final Pattern ENTITY_PATTERN = Pattern.compile("&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);");
    private static final Pattern OPEN_TAG_PATTERN = Pattern.compile("<([a-zA-Z][\\w-]*)\\b([^>]*)>");
    private static final Pattern CLASS_ATTR_PATTERN = Pattern.compile("(?:^|" + WS + ")class" + WS + "*=" + WS + "*([\"'])([\\s\\S]*?)\\1", Pattern.CASE_INSENSITIVE);
    private static final Pattern NEW_POST_SUFFIX = Pattern.compile(WS + "*(?:새로운" + WS + "+|새" + WS + "+)?글이 등록되었습니다\\.?");
    private static final Pattern PROGRESS_SUFFIX = Pattern.compile(WS + "*\\(\\d{1,3}%\\)" + WS + "*$");

    /** lmsScraper.ts NAMED_ENTITIES와 같은 표 */
    private static final Map<String, String> NAMED_ENTITIES = new HashMap<>();

    static {
        NAMED_ENTITIES.put("amp", "&");
        NAMED_ENTITIES.put("lt", "<");
        NAMED_ENTITIES.put("gt", ">");
        NAMED_ENTITIES.put("quot", "\"");
        NAMED_ENTITIES.put("apos", "'");
        NAMED_ENTITIES.put("nbsp", "\u00a0");
        NAMED_ENTITIES.put("middot", "\u00b7");
        NAMED_ENTITIES.put("bull", "\u2022");
        NAMED_ENTITIES.put("hellip", "\u2026");
        NAMED_ENTITIES.put("lsquo", "\u2018");
        NAMED_ENTITIES.put("rsquo", "\u2019");
        NAMED_ENTITIES.put("ldquo", "\u201c");
        NAMED_ENTITIES.put("rdquo", "\u201d");
        NAMED_ENTITIES.put("ndash", "\u2013");
        NAMED_ENTITIES.put("mdash", "\u2014");
        NAMED_ENTITIES.put("times", "\u00d7");
        NAMED_ENTITIES.put("laquo", "\u00ab");
        NAMED_ENTITIES.put("raquo", "\u00bb");
        NAMED_ENTITIES.put("copy", "\u00a9");
        NAMED_ENTITIES.put("reg", "\u00ae");
        NAMED_ENTITIES.put("trade", "\u2122");
    }

    public static List<TodoItem> parse(String html, long now) {
        List<TodoItem> items = new ArrayList<>();
        if (html == null || html.isEmpty()) return items;

        Matcher liMatcher = LI_PATTERN.matcher(html);
        while (liMatcher.find()) {
            String tabClass = liMatcher.group(1).toLowerCase(Locale.ROOT);
            String liContent = liMatcher.group(2);

            if (!tabClass.equals("tab5") && !tabClass.equals("tab2") && !tabClass.equals("tab7") && !tabClass.equals("tab8")) {
                continue;
            }

            String courseId = "";
            String contentId = "";
            Matcher fnMatcher = FN_PATTERN.matcher(liContent);
            if (fnMatcher.find()) {
                String[] args = fnMatcher.group(1).split(",");
                if (args.length > 1) courseId = cleanArg(args[1]);
                if (args.length > 3) contentId = cleanArg(args[3]);
            }

            String subject = textContentByClass(liContent, "subject");
            String title = jsTrim(NEW_POST_SUFFIX.matcher(cleanText(subject == null ? "" : subject)).replaceAll(""));

            if (title.isEmpty()) continue;

            String lec = textContentByClass(liContent, "lec_name");
            String courseNm = cleanLecName(lec == null ? "" : lec);

            Matcher dateMatcher = DATE_PATTERN.matcher(liContent);
            String dateStr = dateMatcher.find() ? cleanText(decodeEntities(dateMatcher.group(1).replaceAll("<[^>]*>", " "))) : "";

            String id;
            boolean isPending = true;

            if (tabClass.equals("tab5")) {
                id = courseId + "_assignment_" + (contentId.isEmpty() ? title : contentId);
                if (parseDeadlineMs(dateStr) < now) {
                    isPending = false; // 이미 마감 지난 과제는 알림 대상 제외
                }
            } else if (tabClass.equals("tab2")) {
                // 진도율 "(NN%)"이 바뀌어도 동일 강의로 인식되도록 ID에서 제외
                id = courseId + "_lecture_" + stripProgress(title);
                if (title.contains("100%")) {
                    isPending = false; // 진도 100% 완료 강의 제외
                }
                if (parseDeadlineMs(dateStr) < now) {
                    isPending = false; // 수강 기간 만료 강의 제외
                }
            } else { // tab7, tab8: 퀴즈 및 시험
                id = courseId + "_quiz_" + (contentId.isEmpty() ? title : contentId);
                if (parseDeadlineMs(dateStr) < now) {
                    isPending = false; // 이미 종료된 퀴즈/시험 제외
                }
            }

            items.add(new TodoItem(id, tabClass, courseId, courseNm, title, dateStr, isPending));
        }

        return items;
    }

    /** lmsScraper.ts stripLectureProgress와 동일 */
    static String stripProgress(String title) {
        if (title == null) return "";
        return jsTrim(PROGRESS_SUFFIX.matcher(title).replaceAll(""));
    }

    static String cleanLecName(String text) {
        if (text == null) return "";
        return jsTrim(cleanText(text)
                .replaceFirst("^[\\(\\[]\\d{2,4}[^\\]\\)]*[\\]\\)]" + WS + "*", "")
                .replaceFirst("^\\[", "")
                .replaceFirst("\\]$", ""));
    }

    private static String cleanArg(String s) {
        if (s == null) return "";
        // lmsScraper.ts: s.trim().replace(/^['"]|['"]$/g, '')
        return jsTrim(s).replaceAll("^['\"]|['\"]$", "");
    }

    /**
     * `el.querySelector('.cls').textContent`와 같은 값 (lmsScraper.ts textContentByClass와 같은 규칙).
     * 클래스 토큰이 정확히 일치하는 첫 요소, 같은 태그의 중첩을 세어 끝 태그를 찾고, 안쪽 태그는 빈 문자열로 제거.
     */
    static String textContentByClass(String html, String cls) {
        Matcher open = OPEN_TAG_PATTERN.matcher(html);
        while (open.find()) {
            Matcher classAttr = CLASS_ATTR_PATTERN.matcher(open.group(2));
            if (!classAttr.find() || !Arrays.asList(classAttr.group(2).split(WS + "+")).contains(cls)) continue;
            int start = open.end();
            Matcher sameTag = Pattern.compile("<(/?)" + Pattern.quote(open.group(1)) + "\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
            int depth = 1;
            int end = html.length();
            int from = start;
            while (sameTag.find(from)) {
                from = sameTag.end();
                if (!sameTag.group(1).isEmpty()) {
                    if (--depth == 0) {
                        end = sameTag.start();
                        break;
                    }
                } else if (!sameTag.group(0).endsWith("/>")) {
                    depth++;
                }
            }
            return decodeEntities(html.substring(start, end).replaceAll("<[^>]*>", ""));
        }
        return null;
    }

    /** src/services/lmsScraper.ts의 cleanText와 같은 순서·규칙 (\s, trim은 JS 공백 범위) */
    static String cleanText(String s) {
        if (s == null || s.isEmpty()) return "";
        return jsTrim(s.replaceAll("(?i)&nbsp;", " ")
                .replaceAll("(?i)&middot;", "\u00b7")
                .replaceAll("(?i)&amp;", "&")
                .replaceAll("(?i)&lt;", "<")
                .replaceAll("(?i)&gt;", ">")
                .replaceAll("(?i)&quot;", "\"")
                .replaceAll("(?i)&#39;", "'")
                .replace('\u00a0', ' ')
                .replaceAll(WS + "+", " ")
                .replaceAll("\\(" + WS + "*학습시간/기준시간" + WS + "*:" + WS + "*", "(")
                .replaceAll(WS + "*\\)", ")"));
    }

    /** JS String.prototype.trim()과 같은 공백 범위로 앞뒤 공백 제거 */
    static String jsTrim(String s) {
        if (s == null) return "";
        return s.replaceAll("^" + WS + "+|" + WS + "+$", "");
    }

    static String decodeEntities(String s) {
        if (s == null || s.indexOf('&') < 0) return s == null ? "" : s;
        Matcher m = ENTITY_PATTERN.matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String name = m.group(1);
            String replacement = null;
            try {
                if (name.startsWith("#x") || name.startsWith("#X")) {
                    replacement = new String(Character.toChars(Integer.parseInt(name.substring(2), 16)));
                } else if (name.startsWith("#")) {
                    replacement = new String(Character.toChars(Integer.parseInt(name.substring(1))));
                } else {
                    replacement = NAMED_ENTITIES.get(name);
                }
            } catch (IllegalArgumentException ignored) {
                // 범위를 벗어난 숫자 엔티티는 그대로 둠 (NumberFormatException 포함)
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement != null ? replacement : m.group(0)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    static long parseDeadlineMs(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) return Long.MAX_VALUE;
        Matcher m = DEADLINE_PATTERN.matcher(dateStr);
        long lastMs = Long.MAX_VALUE;
        while (m.find()) {
            try {
                int y = Integer.parseInt(m.group(1));
                int mon = Integer.parseInt(m.group(2)) - 1;
                int d = Integer.parseInt(m.group(3));
                int h = m.group(4) != null ? Integer.parseInt(m.group(4)) : 23;
                int min = m.group(5) != null ? Integer.parseInt(m.group(5)) : 59;
                int sec = m.group(6) != null ? Integer.parseInt(m.group(6)) : 59;
                Calendar cal = Calendar.getInstance();
                cal.set(y, mon, d, h, min, sec);
                cal.set(Calendar.MILLISECOND, 0);
                lastMs = cal.getTimeInMillis();
            } catch (Exception ignored) {
            }
        }
        return lastMs;
    }
}
