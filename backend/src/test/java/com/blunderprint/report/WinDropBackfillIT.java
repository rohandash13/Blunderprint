package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.analysis.WinChance;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** V4 gives runs analysed before win_drop existed a win_drop, so their reports are not blank. */
class WinDropBackfillIT extends PostgresIT {
    @Autowired ReportService reports;

    private String migrationSql() throws Exception {
        try (var in = getClass().getResourceAsStream("/db/migration/V4__backfill_win_drop.sql")) {
            assertNotNull(in, "V4__backfill_win_drop.sql is on the classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private long move(UUID run, int ply, String before, String after) {
        return jdbc.queryForObject("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', ?, 1, 'w', 1500, 'FEN', ?, ?, 'e2e4', 'e4') returning id""", Long.class, run, ply, before, after);
    }

    @Test
    void backfillsOldRunsExactlyLikeScoringAndTheDefaultReportListsThemUnrated() throws Exception {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'alice', 'sf', 10, 'DONE')", run);
        jdbc.update("insert into game(id, white, black, played_at) values ('g1', 'alice', 'x', now())");
        long scored = move(run, 0, "A", "B");
        long noEvals = move(run, 2, "C", "D");
        long alreadySet = move(run, 4, "A", "B");
        // best +30 for the mover, after-position +200 for the opponent => played -200
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
        // a different depth must not be used
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('C','sf',20,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('D','sf',20,'e7e5',200)");
        for (long id : new long[] {scored, noEvals, alreadySet}) {
            jdbc.update("""
                insert into move_analysis(move_id, cpl, best_uci, p_played, tags) values (?, 230, 'd2d4', 0.4, '{hanging_piece}')""", id);
        }
        jdbc.update("update move_analysis set win_drop = 0.01 where move_id = ?", alreadySet);

        jdbc.execute(migrationSql());

        Double wd = jdbc.queryForObject("select win_drop from move_analysis where move_id = ?", Double.class, scored);
        assertEquals(WinChance.drop(30, -200), wd, 1e-9);
        assertNull(jdbc.queryForObject("select win_drop from move_analysis where move_id = ?", Double.class, noEvals));
        assertEquals(0.01, jdbc.queryForObject("select win_drop from move_analysis where move_id = ?", Double.class, alreadySet), 1e-12);
        // running it again changes nothing
        jdbc.execute(migrationSql());
        assertEquals(wd, jdbc.queryForObject("select win_drop from move_analysis where move_id = ?", Double.class, scored), 0.0);

        var report = reports.report("alice").orElseThrow();
        assertEquals(List.of("tricky", "deep"), report.levels());
        assertEquals(3, report.movesAnalyzed());
        assertEquals(1, report.mistakes());
        assertEquals(1, report.candidates());
        assertEquals(1, report.levelCounts().get("unrated"));
        var pattern = report.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow();
        assertEquals(1, pattern.count());
        assertEquals(1, pattern.examples().size());
        assertEquals("unrated", pattern.examples().get(0).level());
    }
}
