package com.blunderprint.worker;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.store.JobQueueRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

@EnabledIfEnvironmentVariable(named = "STOCKFISH_PATH", matches = ".+")
@TestPropertySource(properties = {"engine.path=${STOCKFISH_PATH}", "engine.version=sf-test"})
class WorkerPoolIT extends PostgresIT {
    @Autowired WorkerPool pool;
    @Autowired JobQueueRepository queue;

    @Test
    void workersDrainTheQueueIntoTheCache() throws Exception {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf-test', 6)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        jdbc.update("""
            insert into move(run_id, game_id, ply, fullmove, mover, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', 0, 1, 'w', 'x', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
                    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -', 'e2e4', 'e4')""", run);
        assertEquals(2, queue.enqueueForRun(run));
        pool.start(2);
        long deadline = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < deadline
            && jdbc.queryForObject("select count(*) from eval_cache", Long.class) < 2) {
            Thread.sleep(200);
        }
        pool.stop();
        assertEquals(2L, jdbc.queryForObject("select count(*) from eval_cache", Long.class));
        assertEquals(2L, jdbc.queryForObject("select count(*) from eval_job where status = 'DONE'", Long.class));
        var stats = pool.stats();
        assertEquals(2L, stats.get("jobs"));
        assertTrue(stats.get("engineNs") > 0 && stats.get("claimNs") > 0 && stats.get("completeNs") > 0);
    }
}
