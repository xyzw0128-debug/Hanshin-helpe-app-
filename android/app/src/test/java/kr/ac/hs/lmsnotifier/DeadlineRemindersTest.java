package kr.ac.hs.lmsnotifier;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import kr.ac.hs.lmsnotifier.TodoListParser.TodoItem;
import org.junit.Test;

/** 백그라운드 확인 결과를 마감 알림 목록에 반영하는 규칙 (DeadlineReminders.merge). 실행: cd android && ./gradlew testDebugUnitTest */
public class DeadlineRemindersTest {
    private static final long NOW = TodoListParser.parseDeadlineMs("2026.10.14 12:00:00");

    private static DeadlineReminders.Item reminder(String id, String dateStr) {
        DeadlineReminders.Item it = new DeadlineReminders.Item();
        it.id = id;
        it.kind = DeadlineReminders.KIND_ASSIGNMENT;
        it.courseNm = "과목";
        it.title = "보고서";
        it.deadlineStr = dateStr;
        it.deadlineMs = TodoListParser.parseDeadlineMs(dateStr);
        return it;
    }

    private static List<DeadlineReminders.Item> saved(DeadlineReminders.Item... items) {
        return new ArrayList<>(Arrays.asList(items));
    }

    private static List<TodoItem> pending(String id, String dateStr) {
        return Collections.singletonList(new TodoItem(id, "tab5", "C1", "과목", "보고서", dateStr, true));
    }

    @Test
    public void extendedDeadlineMovesReminder() {
        DeadlineReminders.MergeResult r = DeadlineReminders.merge(
                saved(reminder("C1_assignment_1", "2026.10.15 23:59")),
                pending("C1_assignment_1", "2026.10.20 23:59"), Collections.emptySet(), NOW);
        assertEquals(1, r.updated);
        assertEquals(0, r.added);
        assertEquals(1, r.next.size());
        assertEquals(TodoListParser.parseDeadlineMs("2026.10.20 23:59"), r.next.get(0).deadlineMs);
        assertEquals("2026.10.20 23:59", r.next.get(0).deadlineStr);
        assertTrue(r.changed());
    }

    @Test
    public void extendedAfterOldDeadlinePassed() {
        // 옛 마감(어제)이 지난 뒤에 연장돼도 목록에 남아 있던 항목을 새 마감으로
        DeadlineReminders.MergeResult r = DeadlineReminders.merge(
                saved(reminder("C1_assignment_1", "2026.10.13 23:59")),
                pending("C1_assignment_1", "2026.10.20 23:59"), Collections.emptySet(), NOW);
        assertEquals(1, r.updated);
        assertEquals(TodoListParser.parseDeadlineMs("2026.10.20 23:59"), r.next.get(0).deadlineMs);
    }

    @Test
    public void sameDeadlineIsLeftAlone() {
        DeadlineReminders.MergeResult r = DeadlineReminders.merge(
                saved(reminder("C1_assignment_1", "2026.10.15 23:59")),
                pending("C1_assignment_1", "2026.10.15 23:59"), Collections.emptySet(), NOW);
        assertEquals(0, r.updated);
        assertFalse(r.changed());
    }

    @Test
    public void completedIsRemovedAndNewIsAdded() {
        DeadlineReminders.MergeResult r = DeadlineReminders.merge(
                saved(reminder("C1_assignment_1", "2026.10.15 23:59")),
                pending("C1_assignment_2", "2026.10.16 23:59"), Collections.singleton("C1_assignment_1"), NOW);
        assertEquals(1, r.removed.size());
        assertEquals(1, r.added);
        assertEquals(1, r.next.size());
        assertEquals("C1_assignment_2", r.next.get(0).id);
    }

    @Test
    public void deadlineSecondsMatchApp() {
        // 앱(lmsScraper.ts parseLectureDeadline)과 같은 규칙: 시:분만 있으면 0초, 날짜만 있으면 23:59:59
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(TodoListParser.parseDeadlineMs("2026.10.15 23:59"));
        assertEquals(0, c.get(Calendar.SECOND));
        c.setTimeInMillis(TodoListParser.parseDeadlineMs("2026.10.15"));
        assertEquals(23, c.get(Calendar.HOUR_OF_DAY));
        assertEquals(59, c.get(Calendar.MINUTE));
        assertEquals(59, c.get(Calendar.SECOND));
    }
}
