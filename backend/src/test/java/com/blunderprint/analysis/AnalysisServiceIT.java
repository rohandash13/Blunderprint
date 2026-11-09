package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.blunderprint.PostgresIT;
import com.blunderprint.model.ModelClient;
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
}
