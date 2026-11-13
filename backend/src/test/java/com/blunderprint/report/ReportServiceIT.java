package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ReportServiceIT extends PostgresIT {
    @Autowired ReportService reports;

    private void seed(UUID run, String status) {
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'alice', 'sf', 10, ?)", run, status);
        jdbc.update("insert into game(id, white, black, played_at) values ('g1', 'alice', 'x', now()) on conflict do nothing");
    }

    /** A move: win_drop, best_quiet and difficulty_elo drive the report; rating 1500 unless given. */
    private void move(UUID run, int ply, int cpl, Double p, String tags, Double winDrop, Boolean quiet, Integer elo) {
        move(run, ply, cpl, p, tags, winDrop, quiet, elo, 1500);
    }

    private void move(UUID run, int ply, int cpl, Double p, String tags, Double winDrop, Boolean quiet, Integer elo,
                      Integer rating) {
        long id = jdbc.queryForObject("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', ?, ?, 'w', ?, 'FEN', 'k', 'k2', 'e2e4', 'e4') returning id""", Long.class, run, ply, ply / 2 + 1, rating);
        jdbc.update("""
            insert into move_analysis(move_id, cpl, best_uci, p_played, tags, win_drop, best_quiet, difficulty_elo)
            values (?, ?, 'd2d4', ?, ?::text[], ?, ?, ?)""", id, cpl, p, tags, winDrop, quiet, elo);
    }

    /** Tactical mistake (win_drop 0.20) with a tricky difficulty for a 1500 player. */
    private void mistake(UUID run, int ply, int cpl, String tags) {
        move(run, ply, cpl, 0.4, tags, 0.20, false, 1500);
    }

    @Test
    void candidateRuleUsesWinDropQuietnessAndHabitFilter() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}", 0.01, true, 1500);                       // fine move
        move(run, 2, 300, 0.4, "{missed_tactic}", 0.20, false, 1500);        // candidate
        move(run, 4, 60, 0.4, "{missed_tactic}", 0.07, false, 1500);         // tactical inaccuracy: excluded
        move(run, 6, 60, 0.4, "{positional}", 0.07, true, 1500);             // quiet inaccuracy: candidate
        move(run, 8, 500, 0.01, "{missed_tactic}", 0.30, false, 1500);       // unlikely human move: excluded
        move(run, 10, 40, 0.4, "{positional}", 0.03, true, 1500);            // below 0.05: excluded
        var r = reports.report("alice", Difficulty.ALL).orElseThrow();
        assertEquals(6, r.movesAnalyzed());
        assertEquals(2, r.mistakes());              // win_drop >= 0.10: plies 2 and 8
        assertEquals(2, r.candidates());
        assertEquals(1, r.patterns().stream().filter(p -> p.tag().equals("positional")).findFirst().orElseThrow().count());
        var tactic = r.patterns().stream().filter(p -> p.tag().equals("missed_tactic")).findFirst().orElseThrow();
        assertEquals(1, tactic.count());
        assertEquals(300, tactic.examples().get(0).cpl());
    }

    @Test
    void exampleFieldsKindSeverityAndElo() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 80, 0.4, "{positional}", 0.07, true, 1700);
        move(run, 4, 200, 0.4, "{positional}", 0.12, true, 1700);
        move(run, 6, 400, 0.4, "{missed_tactic}", 0.30, false, 1700);
        var r = reports.report("alice", Difficulty.ALL).orElseThrow();
        var pos = r.patterns().stream().filter(p -> p.tag().equals("positional")).findFirst().orElseThrow().examples();
        assertEquals("inaccuracy", pos.get(1).severity());
        assertEquals("mistake", pos.get(0).severity());
        assertEquals("positional", pos.get(0).kind());
        assertEquals(1700, pos.get(0).difficultyElo());
        var tac = r.patterns().stream().filter(p -> p.tag().equals("missed_tactic")).findFirst().orElseThrow().examples().get(0);
        assertEquals("blunder", tac.severity());
        assertEquals("tactical", tac.kind());
    }

    @Test
    void dedupesToPrimaryPattern() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        mistake(run, 2, 300, "{endgame_technique,missed_tactic}");
        mistake(run, 4, 300, "{endgame_technique}");
        mistake(run, 6, 300, "{opening_error,positional}");
        mistake(run, 8, 300, "{foo}");
        var r = reports.report("alice", Difficulty.ALL).orElseThrow();
        Map<String, Integer> byTag = new java.util.HashMap<>();
        r.patterns().forEach(p -> byTag.put(p.tag(), p.count()));
        assertEquals(Map.of("missed_tactic", 1, "endgame_technique", 1, "positional", 1, "other", 1), byTag);
        assertEquals(4, r.patterns().stream().mapToInt(ReportService.PatternSummary::count).sum());
    }

    @Test
    void primaryPatternPriority() {
        assertEquals("time_trouble", ReportService.primaryPattern(List.of("endgame_technique", "time_trouble", "missed_tactic")));
        assertEquals("missed_tactic", ReportService.primaryPattern(List.of("hanging_piece", "missed_tactic")));
        assertEquals("hanging_piece", ReportService.primaryPattern(List.of("positional", "hanging_piece")));
        assertEquals("positional", ReportService.primaryPattern(List.of("opening_error", "endgame_technique", "positional")));
        assertEquals("endgame_technique", ReportService.primaryPattern(List.of("opening_error", "endgame_technique")));
        assertEquals("other", ReportService.primaryPattern(List.of()));
    }

    @Test
    void timeTroubleStaysOutOfOtherPatternsAndDefaultExamples() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{missed_tactic,time_trouble}", 0.20, false, 1100);   // slip for 1500, clock error
        move(run, 4, 300, 0.4, "{missed_tactic}", 0.20, false, 1500);                // tricky
        var def = reports.report("alice").orElseThrow();
        var tt = def.patterns().stream().filter(p -> p.tag().equals("time_trouble")).findFirst().orElseThrow();
        assertEquals(1, tt.count());
        assertTrue(tt.examples().isEmpty());
        var tactic = def.patterns().stream().filter(p -> p.tag().equals("missed_tactic")).findFirst().orElseThrow();
        assertEquals(1, tactic.count());
        assertEquals(4, tactic.examples().get(0).ply());
        var withSlip = reports.report("alice", List.of("slip", "tricky")).orElseThrow();
        var tt2 = withSlip.patterns().stream().filter(p -> p.tag().equals("time_trouble")).findFirst().orElseThrow();
        assertEquals(2, tt2.examples().get(0).ply());
    }

    @Test
    void levelsRelativeToRatingFilterAndCount() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 900, 0.4, "{hanging_piece}", 0.4, false, 1200);        // slip at 1500
        move(run, 4, 200, 0.4, "{hanging_piece}", 0.2, false, 1500);        // tricky
        move(run, 6, 300, 0.4, "{missed_tactic}", 0.2, false, 2000);        // deep
        move(run, 8, 300, 0.4, "{missed_tactic}", 0.2, false, null);        // unrated
        move(run, 10, 300, 0.4, "{missed_tactic}", 0.2, false, 1200, 2450); // slip for a 2450 player
        var r = reports.report("alice").orElseThrow();
        assertEquals(List.of("tricky", "deep"), r.levels());
        assertEquals(Map.of("slip", 2, "tricky", 1, "deep", 1, "unrated", 1), r.levelCounts());
        var hanging = r.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow();
        assertEquals(1, hanging.count());
        assertEquals("tricky", hanging.examples().get(0).level());
        var tactic = r.patterns().stream().filter(p -> p.tag().equals("missed_tactic")).findFirst().orElseThrow();
        assertEquals(1, tactic.count());
        assertEquals("deep", tactic.examples().get(0).level());
        var all = reports.report("alice", Difficulty.ALL).orElseThrow();
        assertEquals(2, all.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow().count());
    }

    @Test
    void sortsExamplesByWinDropDescending() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 400, 0.4, "{missed_tactic}", 0.18, false, 1500);
        move(run, 4, 300, 0.4, "{missed_tactic}", 0.35, false, 1500);
        move(run, 6, 500, 0.4, "{missed_tactic}", 0.25, false, 1500);
        var ex = reports.report("alice", Difficulty.ALL).orElseThrow().patterns().get(0).examples();
        assertEquals(List.of(4, 6, 2), ex.stream().map(ReportService.Example::ply).toList());
    }

    @Test
    void usesLatestDoneRunOnly() {
        UUID done = UUID.randomUUID();
        seed(done, "DONE");
        mistake(done, 0, 300, "{hanging_piece}");
        UUID running = UUID.randomUUID();
        seed(running, "RUNNING");
        assertEquals(done, reports.report("alice").orElseThrow().runId());
    }

    @Test
    void emptyWhenNothingDone() {
        assertTrue(reports.report("nobody").isEmpty());
    }

    @Test
    void examplesCarryEngineLineFromCache() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        mistake(run, 2, 300, "{hanging_piece}");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values ('k', 'sf', 10, 1, 'e5f7', 50, 'e5f7 e8f7 d1h5')");
        // same key but other depth must not be picked up
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values ('k', 'sf', 20, 1, 'a2a3', 0, 'a2a3')");
        var ex = reports.report("alice", Difficulty.ALL).orElseThrow().patterns().get(0).examples().get(0);
        assertEquals(List.of("e5f7", "e8f7", "d1h5"), ex.pv());
    }

    @Test
    void exampleWithoutCacheRowHasEmptyPv() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        mistake(run, 2, 300, "{hanging_piece}");
        var ex = reports.report("alice", Difficulty.ALL).orElseThrow().patterns().get(0).examples().get(0);
        assertTrue(ex.pv().isEmpty());
    }

    @Test
    void mistakeRowsCarryNewFields() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}", 0.01, true, 1500);                      // not a candidate
        move(run, 1, 500, 0.01, "{missed_tactic}", 0.3, false, 1500);       // unlikely human move
        move(run, 2, 300, 0.4, "{hanging_piece}", 0.2, false, 2000);        // deep
        move(run, 4, 70, 0.4, "{positional}", 0.07, true, 1100);            // slip, inaccuracy
        var rows = reports.mistakes("alice");
        assertNull(rows.get(0).level());
        assertNull(rows.get(0).severity());
        assertNull(rows.get(1).level());
        assertEquals("blunder", rows.get(1).severity());
        var deep = rows.get(2);
        assertEquals("deep", deep.level());
        assertEquals("tactical", deep.kind());
        assertEquals(0.2, deep.winDrop(), 1e-9);
        assertEquals(2000, deep.difficultyElo());
        var slip = rows.get(3);
        assertEquals("slip", slip.level());
        assertEquals("positional", slip.kind());
        assertEquals("inaccuracy", slip.severity());
    }

    @Test
    void unratedRunStillReturnsPatternsByDefault() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{hanging_piece}", 0.2, false, null);
        move(run, 4, 200, 0.3, "{missed_tactic}", 0.2, false, null);
        var r = reports.report("alice").orElseThrow();
        assertEquals(List.of("tricky", "deep"), r.levels());
        assertEquals(2, r.patterns().size());
        assertTrue(r.patterns().stream().flatMap(p -> p.examples().stream()).allMatch(e -> e.level().equals("unrated")));
        assertEquals(2, r.levelCounts().get("unrated"));
    }

    @Test
    void levelBoundariesAgreeBetweenReportSqlAndMistakesJava() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        // rating 1500: slip <= 1200, tricky 1201..1600, deep > 1600; a null rating counts as 1500.
        // One pattern per row so the three-example cap never hides one.
        move(run, 2, 300, 0.4, "{hanging_piece}", 0.2, false, 1200, 1500);          // slip
        move(run, 4, 300, 0.4, "{missed_tactic}", 0.2, false, 1201, 1500);          // tricky
        move(run, 6, 300, 0.4, "{positional}", 0.2, false, 1600, 1500);             // tricky
        move(run, 8, 300, 0.4, "{endgame_technique}", 0.2, false, 1601, 1500);      // deep
        move(run, 10, 300, 0.4, "{opening_error}", 0.2, false, 1200, null);         // slip (rating 1500)
        move(run, 12, 300, 0.4, "{foo}", 0.2, false, 1601, null);                   // deep (rating 1500)
        Map<Integer, String> expected = Map.of(2, "slip", 4, "tricky", 6, "tricky", 8, "deep", 10, "slip", 12, "deep");

        Map<Integer, String> sqlLevels = new java.util.HashMap<>();
        reports.report("alice", Difficulty.ALL).orElseThrow().patterns()
            .forEach(p -> p.examples().forEach(e -> sqlLevels.put(e.ply(), e.level())));
        Map<Integer, String> javaLevels = new java.util.HashMap<>();
        reports.mistakes("alice").forEach(r -> javaLevels.put(r.ply(), r.level()));

        assertEquals(expected, sqlLevels);
        assertEquals(expected, javaLevels);
    }

    @Test
    void clockCandidatesOnlyCountTowardLevelChipsWhenSlipIsFiltered() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 2, 300, 0.4, "{missed_tactic,time_trouble}", 0.20, false, 1100);   // clock, slip
        move(run, 4, 300, 0.4, "{time_trouble}", 0.20, false, 1500);                  // clock, tricky
        move(run, 6, 300, 0.4, "{missed_tactic}", 0.20, false, 1500);                 // tricky
        var def = reports.report("alice").orElseThrow();
        assertEquals(Map.of("slip", 0, "tricky", 1, "deep", 0, "unrated", 0), def.levelCounts());
        var withSlip = reports.report("alice", List.of("slip", "tricky")).orElseThrow();
        assertEquals(Map.of("slip", 1, "tricky", 2, "deep", 0, "unrated", 0), withSlip.levelCounts());
    }
}
