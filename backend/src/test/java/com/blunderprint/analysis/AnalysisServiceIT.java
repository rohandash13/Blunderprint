package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.blunderprint.PostgresIT;
import com.blunderprint.engine.EngineTracer;
import com.blunderprint.engine.Trace;
import com.blunderprint.model.ModelClient;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;

class AnalysisServiceIT extends PostgresIT {
    @Autowired AnalysisService analysis;
    @MockBean ModelClient model;
    @MockBean EngineTracer tracer;

    private UUID seed() {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf', 10)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        jdbc.update("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', 0, 1, 'w', 1500, 'A 0 1', 'A', 'B', 'e2e4', 'e4')""", run);
        return run;
    }

    @Test
    void progressCountsCachedFens() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth) values ('B','sf',10)");
        var p = analysis.progress(run);
        assertEquals(2, p.totalFens());
        assertEquals(1, p.doneFens());
        assertEquals("RUNNING", p.status());
    }

    @Test
    void tickScoresAndMarksDone() {
        UUID run = seed();
        // best before = +30 for mover; after-position (opponent view) = +200  => played = -200 => cpl 230
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
        when(model.analyze(anyList())).thenAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return List.of(new ModelClient.MoveOut(in.get(0).id(), 0.4, List.of("opening_error")));
        });
        analysis.tick();
        var row = jdbc.queryForMap("select cpl, best_uci, p_played, tags from move_analysis");
        assertEquals(230, row.get("cpl"));
        assertEquals("d2d4", row.get("best_uci"));
        assertEquals(0.4, (Double) row.get("p_played"), 1e-9);
        assertEquals("DONE", analysis.progress(run).status());
    }

    @Test
    void tickStoresPBest() {
        seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
        when(model.analyze(anyList())).thenAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return List.of(new ModelClient.MoveOut(in.get(0).id(), 0.4, List.of(), 0.07));
        });
        analysis.tick();
        assertEquals(0.07, jdbc.queryForObject("select p_best from move_analysis", Double.class), 1e-9);
    }

    @Test
    void rescoreLatestRefreshesDoneRunAndIsIdempotent() {
        UUID run = seed();
        jdbc.update("update analysis_run set status = 'DONE' where id = ?", run);
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
        when(model.analyze(anyList())).thenAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return List.of(new ModelClient.MoveOut(in.get(0).id(), 0.4, List.of("opening_error"), 0.3));
        });
        assertEquals(1, analysis.rescoreLatest("U").getAsInt());   // username match is case-insensitive
        assertEquals(1, analysis.rescoreLatest("u").getAsInt());
        assertEquals(1, jdbc.queryForObject("select count(*) from move_analysis", Integer.class));
        assertEquals(0.3, jdbc.queryForObject("select p_best from move_analysis", Double.class), 1e-9);
        assertTrue(analysis.rescoreLatest("nobody").isEmpty());
    }

    @Test
    void rescorePersistsEveryMoveAcrossModelBatchBoundaryAndRemainsIdempotent() {
        UUID run = seed();
        jdbc.update("update analysis_run set status = 'DONE' where id = ?", run);
        jdbc.update("""
            insert into move(run_id,game_id,ply,fullmove,mover,rating,before_fen,before_key,after_key,played_uci,played_san)
            select ?, 'g1', n, n+1, 'w', 1500, 'A 0 1', 'A', 'B', 'e2e4', 'e4'
            from generate_series(1,299) n
            """, run);
        jdbc.update("insert into eval_cache(fen_key,engine,depth,best_uci,score_cp) values ('A','sf',10,'d2d4',30),('B','sf',10,'e7e5',200)");
        when(model.analyze(anyList())).thenAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return in.stream().map(m -> new ModelClient.MoveOut(m.id(),0.1,List.of("opening_error"),0.3,true,false)).toList();
        });
        for (int attempt = 0; attempt < 2; attempt++) {
            assertEquals(300, analysis.rescoreLatest("u").getAsInt());
            assertEquals(300, jdbc.queryForObject("""
                select count(*) from move_analysis where cpl=230 and best_uci='d2d4'
                and p_played=0.1 and p_best=0.3 and tags=array['opening_error']::text[]
                and best_quiet=true and best_free_material=false
                """, Integer.class));
            assertEquals("DONE", analysis.progress(run).status());
        }
        verify(tracer, never()).trace(anyString(), anyString());
    }

    @Test
    void tickWaitsWhileEvalsAreOutstanding() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth, status) values ('B','sf',10,'RUNNING')");
        analysis.tick();
        assertEquals("RUNNING", analysis.progress(run).status());
    }

    @Test
    void tickSkipsMovesWhoseEvalsFailed() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth, status) values ('B','sf',10,'FAILED')");
        when(model.analyze(anyList())).thenReturn(List.of());
        analysis.tick();
        assertEquals("DONE", analysis.progress(run).status());
        assertEquals(0L, jdbc.queryForObject("select count(*) from move_analysis", Long.class));
    }

    private void seedEvals() {
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
    }

    @Test
    void clientErrorFromModelFailsRunImmediately() {
        UUID run = seed();
        seedEvals();
        when(model.analyze(anyList())).thenThrow(HttpClientErrorException.create(
            HttpStatus.UNPROCESSABLE_ENTITY, "Unprocessable", null, new byte[0], null));
        analysis.tick();
        assertEquals("FAILED", analysis.progress(run).status());
    }

    @Test
    void serverErrorsAreRetriedThenSucceed() {
        UUID run = seed();
        seedEvals();
        when(model.analyze(anyList()))
            .thenThrow(HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway", null, new byte[0], null))
            .thenThrow(HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway", null, new byte[0], null))
            .thenAnswer(inv -> {
                List<ModelClient.MoveIn> in = inv.getArgument(0);
                return List.of(new ModelClient.MoveOut(in.get(0).id(), 0.4, List.of()));
            });
        analysis.tick();
        assertEquals("SCORING", analysis.progress(run).status());
        analysis.tick();
        assertEquals("SCORING", analysis.progress(run).status());
        analysis.tick();
        assertEquals("DONE", analysis.progress(run).status());
    }

    @Test
    void persistentServerErrorsFailRunAfterThreeAttempts() {
        UUID run = seed();
        seedEvals();
        when(model.analyze(anyList())).thenThrow(
            HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway", null, new byte[0], null));
        analysis.tick();
        analysis.tick();
        assertEquals("SCORING", analysis.progress(run).status());
        analysis.tick();
        assertEquals("FAILED", analysis.progress(run).status());
    }

    private void stubModel(double pPlayed, boolean quiet, boolean free) {
        org.mockito.Mockito.doAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return List.of(new ModelClient.MoveOut(in.get(0).id(), pPlayed, List.of(), 0.1, quiet, free));
        }).when(model).analyze(anyList());
    }

    @Test
    void storesWinDropAndFlagsAndTracesCandidate() {
        seed();
        seedEvals();
        stubModel(0.4, true, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("d2d4", 100, -100, "c2c4", 6, true)));
        analysis.tick();
        var row = jdbc.queryForMap("select win_drop, best_quiet, best_free_material, find_depth, only_move, difficulty_elo from move_analysis");
        assertEquals(WinChance.drop(30, -200), (Double) row.get("win_drop"), 1e-9);
        assertEquals(true, row.get("best_quiet"));
        assertEquals(false, row.get("best_free_material"));
        assertEquals(6, row.get("find_depth"));
        assertEquals(true, row.get("only_move"));
        assertEquals(DifficultyEstimator.estimate(6, false, true, true), row.get("difficulty_elo"));
        verify(tracer, times(1)).trace(anyString(), anyString());
    }

    @Test
    void emptyTraceLeavesNullsAndRunStillDone() {
        UUID run = seed();
        seedEvals();
        stubModel(0.4, false, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.empty());
        analysis.tick();
        var row = jdbc.queryForMap("select find_depth, only_move, difficulty_elo from move_analysis");
        assertNull(row.get("find_depth"));
        assertNull(row.get("only_move"));
        assertNull(row.get("difficulty_elo"));
        assertEquals("DONE", analysis.progress(run).status());
    }

    @Test
    void nonCandidatesAreNotTraced() {
        seed();
        seedEvals();
        // low p_played: habit filter excludes it
        stubModel(0.05, false, false);
        analysis.tick();
        verify(tracer, never()).trace(anyString(), anyString());
        assertNull(jdbc.queryForObject("select find_depth from move_analysis", Integer.class));
    }

    @Test
    void smallDropNeedsQuietBestMove() {
        UUID run = seed();
        // best +150, after (opponent view) -40 => played +40 => win_drop ~ 0.066 (inaccuracy range)
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',150)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',-40)");
        stubModel(0.4, false, false);
        analysis.tick();
        verify(tracer, never()).trace(anyString(), anyString());
        analysis.rescoreLatest("u");
        verify(tracer, never()).trace(anyString(), anyString());
        stubModel(0.4, true, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("d2d4", 150, 100, "c2c4", 3, true)));
        analysis.rescoreLatest("u");
        verify(tracer, times(1)).trace("A", "d2d4");
        assertEquals(false, jdbc.queryForObject("select only_move from move_analysis", Boolean.class));
        assertEquals("DONE", analysis.progress(run).status());
    }

    private Object diffCol(String col) {
        return jdbc.queryForObject("select " + col + " from move_analysis", Object.class);
    }

    @Test
    void nullSecondScoreMeansNotAnOnlyMove() {
        seed();
        seedEvals();
        stubModel(0.4, false, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("d2d4", 100, null, null, 6, true)));
        analysis.tick();
        assertEquals(false, diffCol("only_move"));
        assertEquals(DifficultyEstimator.estimate(6, false, false, false), diffCol("difficulty_elo"));
    }

    @Test
    void targetOnlyInSecondLineIsTreatedAsDisagreed() {
        seed();
        seedEvals();
        stubModel(0.4, false, false);
        // The engine now prefers another move; findDepth for the second line would just be the final depth.
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("g1f3", 300, 100, "d2d4", 14, false)));
        analysis.tick();
        assertNull(diffCol("find_depth"));
        assertNull(diffCol("only_move"));
        assertNull(diffCol("difficulty_elo"));
    }

    @Test
    void targetInNeitherLineLeavesDifficultyNull() {
        UUID run = seed();
        seedEvals();
        stubModel(0.4, false, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("g1f3", 300, 100, "c2c4", 14, false)));
        analysis.tick();
        assertNull(diffCol("find_depth"));
        assertNull(diffCol("only_move"));
        assertNull(diffCol("difficulty_elo"));
        assertEquals("DONE", analysis.progress(run).status());
    }

    @Test
    void rescoreKeepsOldDifficultyUntilReplacedAndNullsUntracedRows() {
        UUID run = seed();
        jdbc.update("update analysis_run set status = 'DONE' where id = ?", run);
        seedEvals();
        stubModel(0.4, false, false);
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.of(new Trace("d2d4", 100, -100, "c2c4", 6, true)));
        analysis.rescoreLatest("u");
        Object first = diffCol("difficulty_elo");
        assertNotNull(first);

        // During the rescore's trace pass the earlier estimate must still be visible (no blank report).
        java.util.List<Object> seenDuringRescore = new java.util.ArrayList<>();
        when(tracer.trace("A", "d2d4")).thenAnswer(inv -> {
            seenDuringRescore.add(diffCol("difficulty_elo"));
            return Optional.of(new Trace("d2d4", 100, -100, "c2c4", 3, true));
        });
        analysis.rescoreLatest("u");
        assertEquals(List.of(first), seenDuringRescore);
        assertNotEquals(first, diffCol("difficulty_elo"));

        // A failed trace on a later rescore leaves that row without a (stale) estimate.
        when(tracer.trace("A", "d2d4")).thenReturn(Optional.empty());
        analysis.rescoreLatest("u");
        assertNull(diffCol("difficulty_elo"));
        assertNull(diffCol("find_depth"));
    }
}
