package com.blunderprint.store;

import com.blunderprint.engine.EngineResult;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JobQueueRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public JobQueueRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public int enqueueForRun(UUID runId) {
        return jdbc.update("""
            insert into eval_job (fen_key, engine, depth)
            select distinct x.k, r.engine, r.depth
            from analysis_run r,
                 (select before_key k, run_id from move where run_id = ?
                  union select after_key, run_id from move where run_id = ?) x
            where r.id = ? and x.run_id = r.id
              and not exists (select 1 from eval_cache c
                              where c.fen_key = x.k and c.engine = r.engine and c.depth = r.depth and c.multipv = 1)
            on conflict (fen_key, engine, depth)
            do update set status = 'PENDING', attempts = 0, locked_by = null, locked_at = null
            where eval_job.status = 'FAILED'
            """, runId, runId, runId);
    }

    public List<Job> claim(String workerId, int limit) {
        return jdbc.query("""
            update eval_job set status = 'RUNNING', locked_by = ?, locked_at = now()
            where id in (select id from eval_job where status = 'PENDING' order by id limit ? for update skip locked)
            returning id, fen_key, engine, depth, attempts
            """, (rs, i) -> new Job(rs.getLong("id"), rs.getString("fen_key"), rs.getString("engine"),
                rs.getInt("depth"), rs.getInt("attempts")), workerId, limit);
    }

    public void complete(Job job, EngineResult r) {
        tx.executeWithoutResult(s -> {
            jdbc.update("""
                insert into eval_cache (fen_key, engine, depth, multipv, best_uci, score_cp, pv)
                values (?, ?, ?, 1, ?, ?, ?) on conflict do nothing
                """, job.fenKey(), job.engine(), job.depth(), r.bestUci(), r.scoreCp(), r.pv());
            jdbc.update("update eval_job set status = 'DONE', locked_by = null, locked_at = null where id = ?", job.id());
        });
    }

    public void fail(long jobId, String error, int maxAttempts) {
        jdbc.update("""
            update eval_job set attempts = attempts + 1, last_error = ?, locked_by = null, locked_at = null,
                status = case when attempts + 1 >= ? then 'FAILED' else 'PENDING' end
            where id = ?
            """, error, maxAttempts, jobId);
    }

    public int reapStale(int timeoutSeconds, int maxAttempts) {
        return jdbc.update("""
            update eval_job set attempts = attempts + 1, locked_by = null, locked_at = null,
                status = case when attempts + 1 >= ? then 'FAILED' else 'PENDING' end
            where status = 'RUNNING' and locked_at < now() - make_interval(secs => ?)
            """, maxAttempts, timeoutSeconds);
    }
}
