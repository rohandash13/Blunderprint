package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class AnalysisGateIT extends PostgresIT {
    @Autowired AnalysisService analysis;
    private final Instant now = Instant.now();

    private AnalysisGate gate() {
        return new AnalysisGate(jdbc, Clock.fixed(now, ZoneOffset.UTC), 40, 3, 7, 20);
    }

    private UUID run(String user, String status, Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth, status, created_at) values (?,?,?,?,?,?)",
            id, user, "e", 12, status, Timestamp.from(createdAt));
        return id;
    }

    private void moves(UUID run, String game, int n) {
        jdbc.update("insert into game(id, white, black) values (?, 'a', 'b') on conflict do nothing", game);
        for (int i = 0; i < n; i++) {
            jdbc.update("insert into move(run_id, game_id, ply, fullmove, mover, before_fen, before_key, after_key, "
                + "played_uci, played_san) values (?,?,?,?,?,?,?,?,?,?)", run, game, i * 2, i + 1, "w", "f", "b" + i,
                "a" + i, "e2e4", "e4");
        }
    }

    @Test
    void reusesDoneRunUnderSevenDaysCaseInsensitively() {
        UUID id = run("Alice", "DONE", now.minusSeconds(6 * 86400));
        moves(id, "g1", 3);
        var r = gate().findReusable("alice").orElseThrow();
        assertEquals(id, r.runId());
        assertEquals(1, r.games());
        assertEquals(3, r.moves());
        assertEquals(0, r.queuePosition());
    }

    @Test
    void doesNotReuseOldFailedOrOtherUsersRuns() {
        run("alice", "DONE", now.minusSeconds(8 * 86400));
        run("alice", "FAILED", now.minusSeconds(60));
        run("bob", "DONE", now.minusSeconds(60));
        assertTrue(gate().findReusable("alice").isEmpty());
    }

    @Test
    void reusesInFlightRunToo() {
        UUID id = run("alice", "RUNNING", now.minusSeconds(60));
        assertEquals(id, gate().findReusable("alice").orElseThrow().runId());
    }

    @Test
    void queuePositionCountsEarlierUnfinishedRuns() {
        run("x", "DONE", now.minusSeconds(500));
        run("y", "FAILED", now.minusSeconds(400));
        UUID a = run("a", "RUNNING", now.minusSeconds(300));
        UUID b = run("b", "SCORING", now.minusSeconds(200));
        UUID c = run("c", "RUNNING", now.minusSeconds(100));
        var g = gate();
        assertEquals(0, g.queuePosition(a));
        assertEquals(1, g.queuePosition(b));
        assertEquals(2, g.queuePosition(c));
        assertEquals(2, analysis.progress(c).queuePosition());
    }

    @Test
    void unfinishedRunsOlderThanSixHoursAreIgnored() {
        run("old", "RUNNING", now.minusSeconds(7 * 3600));
        run("alice", "RUNNING", now.minusSeconds(7 * 3600));
        UUID c = run("c", "RUNNING", now.minusSeconds(100));
        var g = gate();
        assertEquals(0, g.queuePosition(c));
        assertTrue(g.findReusable("alice").isEmpty());
    }

    @Test
    void finishedRunHasQueuePositionZero() {
        run("a", "RUNNING", now.minusSeconds(300));
        UUID d = run("d", "DONE", now.minusSeconds(100));
        assertEquals(0, gate().queuePosition(d));
    }

    @Test
    void playerStatusReportsLatestRunOrNone() {
        var g = gate();
        assertEquals("none", g.playerStatus("alice").status());
        assertNull(g.playerStatus("alice").runId());
        run("Alice", "DONE", now.minusSeconds(300));
        UUID latest = run("alice", "RUNNING", now.minusSeconds(100));
        var s = g.playerStatus("ALICE");
        assertEquals("RUNNING", s.status());
        assertEquals(latest, s.runId());
        assertEquals(0, s.queuePosition());
    }
}
