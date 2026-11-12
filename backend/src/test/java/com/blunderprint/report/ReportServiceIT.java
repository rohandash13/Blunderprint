package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ReportServiceIT extends PostgresIT {
    @Autowired ReportService reports;

    private void seed(UUID run, String status) {
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'alice', 'sf', 10, ?)", run, status);
        jdbc.update("insert into game(id, white, black, played_at) values ('g1', 'alice', 'x', now()) on conflict do nothing");
    }

    private void move(UUID run, int ply, int cpl, Double p, String tags) {
        move(run, ply, cpl, p, tags, 0.3);
    }

    private void move(UUID run, int ply, int cpl, Double p, String tags, Double pBest) {
        long id = jdbc.queryForObject("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', ?, ?, 'w', 1500, 'FEN', 'k', 'k2', 'e2e4', 'e4') returning id""", Long.class, run, ply, ply / 2 + 1);
        jdbc.update("insert into move_analysis(move_id, cpl, best_uci, p_played, tags, p_best) values (?, ?, 'd2d4', ?, ?::text[], ?)",
            id, cpl, p, tags, pBest);
    }

    @Test
    void aggregatesCandidatesByTag() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}");                                   // fine move
        move(run, 2, 300, 0.40, "{hanging_piece,time_trouble}");       // candidate
        move(run, 4, 150, 0.20, "{hanging_piece}");                    // candidate
        move(run, 6, 500, 0.01, "{missed_tactic}");                    // mistake but unlikely human move => not a candidate
        var r = reports.report("alice").orElseThrow();
        assertEquals(4, r.movesAnalyzed());
        assertEquals(3, r.mistakes());
        assertEquals(2, r.candidates());
        var hanging = r.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow();
        assertEquals(2, hanging.count());
        assertEquals(225.0, hanging.avgCpl(), 1e-9);
        assertEquals(300, hanging.examples().get(0).cpl());           // worst first
        assertTrue(r.patterns().stream().noneMatch(p -> p.tag().equals("missed_tactic")));
    }

    @Test
    void usesLatestDoneRunOnly() {
        UUID done = UUID.randomUUID();
        seed(done, "DONE");
        move(done, 0, 300, 0.5, "{hanging_piece}");
        UUID running = UUID.randomUUID();
        seed(running, "RUNNING");
        assertEquals(done, reports.report("alice").orElseThrow().runId());
    }

    @Test
    void emptyWhenNothingDone() {
        assertTrue(reports.report("nobody").isEmpty());
    }

    @Test
    void mistakesListReturnsAllMoves() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}");
        move(run, 2, 300, 0.4, "{hanging_piece}");
        var rows = reports.mistakes("alice");
        assertEquals(2, rows.size());
        assertEquals(java.util.List.of("hanging_piece"), rows.get(1).tags());
    }

    @Test
    void examplesCarryEngineLineFromCache() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{hanging_piece}");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values ('k', 'sf', 10, 1, 'e5f7', 50, 'e5f7 e8f7 d1h5')");
        // same key but other depth must not be picked up
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values ('k', 'sf', 20, 1, 'a2a3', 0, 'a2a3')");
        var ex = reports.report("alice").orElseThrow().patterns().get(0).examples().get(0);
        assertEquals(java.util.List.of("e5f7", "e8f7", "d1h5"), ex.pv());
    }

    @Test
    void exampleWithoutCacheRowHasEmptyPv() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{hanging_piece}");
        var ex = reports.report("alice").orElseThrow().patterns().get(0).examples().get(0);
        assertTrue(ex.pv().isEmpty());
    }

    @Test
    void filtersByLevelAndCountsAllLevels() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 900, 0.4, "{hanging_piece}", 0.9);    // slip
        move(run, 4, 200, 0.4, "{hanging_piece}", 0.3);    // tricky
        move(run, 6, 300, 0.4, "{missed_tactic}", 0.05);   // deep
        move(run, 8, 300, 0.4, "{missed_tactic}", null);   // unrated
        var r = reports.report("alice").orElseThrow();
        assertEquals(List.of("tricky", "deep"), r.levels());
        assertEquals(java.util.Map.of("slip", 1, "tricky", 1, "deep", 1, "unrated", 1), r.levelCounts());
        var hanging = r.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow();
        assertEquals(1, hanging.count());
        assertEquals("tricky", hanging.examples().get(0).level());
        assertEquals(0.3, hanging.examples().get(0).pBest(), 1e-9);
        var all = reports.report("alice", List.of("slip", "tricky", "deep", "unrated")).orElseThrow();
        assertEquals(2, all.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow().count());
    }

    @Test
    void sortsExamplesByCostTimesDifficulty() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 400, 0.4, "{missed_tactic}", 0.45);   // 400 * 0.55 = 220
        move(run, 4, 300, 0.4, "{missed_tactic}", 0.02);   // 300 * 0.98 = 294
        var ex = reports.report("alice").orElseThrow().patterns().get(0).examples();
        assertEquals(300, ex.get(0).cpl());
        assertEquals(400, ex.get(1).cpl());
    }

    @Test
    void mistakeRowsCarryLevel() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{hanging_piece}", 0.05);
        var row = reports.mistakes("alice").get(0);
        assertEquals("deep", row.level());
        assertEquals(0.05, row.pBest(), 1e-9);
    }
}
