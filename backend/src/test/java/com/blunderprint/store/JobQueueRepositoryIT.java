package com.blunderprint.store;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.engine.EngineResult;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class JobQueueRepositoryIT extends PostgresIT {
    @Autowired JobQueueRepository queue;

    private UUID seedRun(String... keys) {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf', 10)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        int ply = 0;
        for (String k : keys) {
            jdbc.update("""
                insert into move(run_id, game_id, ply, fullmove, mover, before_fen, before_key, after_key, played_uci, played_san)
                values (?, 'g1', ?, 1, 'w', ?, ?, ?, 'e2e4', 'e4')""", run, ply++, k + " 0 1", k, k + "-after");
        }
        return run;
    }

    @Test
    void enqueueIsIdempotentAndSkipsCached() {
        UUID run = seedRun("a", "b");
        assertEquals(4, queue.enqueueForRun(run));      // a, b, a-after, b-after
        assertEquals(0, queue.enqueueForRun(run));      // nothing new
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('a','sf',10,0)");
        jdbc.execute("delete from eval_job");
        assertEquals(3, queue.enqueueForRun(run));      // 'a' is cached
    }

    @Test
    void claimCompleteStoresEvalAndMarksDone() {
        queue.enqueueForRun(seedRun("a"));
        List<Job> jobs = queue.claim("w1", 10);
        assertEquals(2, jobs.size());
        queue.complete(jobs.get(0), new EngineResult("e2e4", 25, "e2e4 e7e5"));
        assertEquals(1L, jdbc.queryForObject("select count(*) from eval_cache", Long.class));
        assertEquals("DONE", jdbc.queryForObject("select status from eval_job where id=?", String.class, jobs.get(0).id()));
        assertTrue(queue.claim("w2", 10).isEmpty());   // the other job is RUNNING
    }

    @Test
    void completeBatchStoresAllResultsAndMarksJobsDone() {
        queue.enqueueForRun(seedRun("a", "b"));           // 4 distinct positions
        List<Job> jobs = queue.claim("w1", 4);
        assertEquals(4, jobs.size());
        queue.completeBatch(jobs.stream()
            .map(j -> new JobQueueRepository.Completed(j, new EngineResult("e2e4", 10, "e2e4"))).toList());
        assertEquals(4L, jdbc.queryForObject("select count(*) from eval_cache", Long.class));
        assertEquals(4L, jdbc.queryForObject("select count(*) from eval_job where status = 'DONE'", Long.class));
        queue.completeBatch(List.of());                    // empty batch is a no-op
    }

    @Test
    void failRetriesThenGivesUp() {
        queue.enqueueForRun(seedRun("a"));
        Job j = queue.claim("w1", 1).get(0);
        queue.fail(j.id(), "boom", 2);
        assertEquals("PENDING", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
        Job again = queue.claim("w1", 1).stream().filter(x -> x.id() == j.id()).findFirst().orElseThrow();
        queue.fail(again.id(), "boom", 2);
        assertEquals("FAILED", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
        assertEquals(1, queue.enqueueForRun(jdbc.queryForObject("select id from analysis_run", UUID.class)));  // FAILED reset
    }

    @Test
    void reapsStaleRunningJobs() {
        queue.enqueueForRun(seedRun("a"));
        Job j = queue.claim("w1", 1).get(0);
        jdbc.update("update eval_job set locked_at = now() - interval '10 minutes' where id=?", j.id());
        assertEquals(1, queue.reapStale(60, 3));
        assertEquals("PENDING", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
    }

    @Test
    void concurrentWorkersNeverDoubleClaim() throws Exception {
        UUID run = seedRun(java.util.stream.IntStream.range(0, 100).mapToObj(i -> "k" + i).toArray(String[]::new));
        assertEquals(200, queue.enqueueForRun(run));
        Set<Long> seen = ConcurrentHashMap.newKeySet();
        List<Long> dupes = Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Future<?>> fs = new ArrayList<>();
        for (int w = 0; w < 8; w++) {
            String id = "w" + w;
            fs.add(pool.submit(() -> {
                List<Job> batch;
                while (!(batch = queue.claim(id, 5)).isEmpty()) {
                    for (Job job : batch) if (!seen.add(job.id())) dupes.add(job.id());
                }
            }));
        }
        for (Future<?> f : fs) f.get(30, TimeUnit.SECONDS);
        pool.shutdown();
        assertTrue(dupes.isEmpty(), "double-claimed: " + dupes);
        assertEquals(200, seen.size());
    }
}
