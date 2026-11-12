package com.blunderprint.analysis;

import com.blunderprint.model.ModelClient;
import com.blunderprint.model.ModelClient.MoveIn;
import com.blunderprint.model.ModelClient.MoveOut;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class AnalysisService {
    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
    private static final int MODEL_BATCH = 256;
    private static final int MAX_SCORING_ATTEMPTS = 3;

    public record Progress(String status, long totalFens, long doneFens, long failedFens) {}

    private record Scored(long moveId, String fen, Integer rating, String playedUci, String bestUci,
                          int cpl, Integer clockCs) {}

    private final JdbcTemplate jdbc;
    private final ModelClient model;
    private final ConcurrentHashMap<UUID, Integer> scoringFailures = new ConcurrentHashMap<>();

    public AnalysisService(JdbcTemplate jdbc, ModelClient model) {
        this.jdbc = jdbc;
        this.model = model;
    }

    public Progress progress(UUID runId) {
        String status = jdbc.queryForObject("select status from analysis_run where id = ?", String.class, runId);
        var row = jdbc.queryForMap("""
            with r as (select engine, depth from analysis_run where id = ?),
                 keys as (select before_key k from move where run_id = ? union select after_key from move where run_id = ?)
            select count(*) total,
                   count(c.fen_key) done,
                   count(*) filter (where c.fen_key is null and j.status = 'FAILED') failed
            from keys
            cross join r
            left join eval_cache c on c.fen_key = keys.k and c.engine = r.engine and c.depth = r.depth and c.multipv = 1
            left join eval_job j on j.fen_key = keys.k and j.engine = r.engine and j.depth = r.depth
            """, runId, runId, runId);
        return new Progress(status, ((Number) row.get("total")).longValue(),
            ((Number) row.get("done")).longValue(), ((Number) row.get("failed")).longValue());
    }

    @Scheduled(fixedDelay = 2000)
    public void tick() {
        List<UUID> runs = jdbc.queryForList(
            "select id from analysis_run where status in ('RUNNING','SCORING') order by created_at", UUID.class);
        for (UUID run : runs) {
            Progress p = progress(run);
            if (p.doneFens() + p.failedFens() < p.totalFens()) continue;
            try {
                jdbc.update("update analysis_run set status = 'SCORING' where id = ?", run);
                score(run);
                jdbc.update("update analysis_run set status = 'DONE' where id = ?", run);
                scoringFailures.remove(run);
            } catch (Exception e) {
                int attempts = scoringFailures.merge(run, 1, Integer::sum);
                if (e instanceof HttpClientErrorException || attempts >= MAX_SCORING_ATTEMPTS) {
                    // The run table has no error column, so the reason is only logged.
                    log.error("scoring run {} failed (attempt {}), marking FAILED: {}", run, attempts, e.toString());
                    jdbc.update("update analysis_run set status = 'FAILED' where id = ?", run);
                    scoringFailures.remove(run);
                } else {
                    log.warn("scoring run {} failed (attempt {}/{}), will retry: {}", run, attempts,
                        MAX_SCORING_ATTEMPTS, e.toString());
                }
            }
        }
    }

    private int score(UUID run) {
        List<Scored> rows = jdbc.query("""
            select m.id, m.before_fen, m.rating, m.played_uci, m.clock_cs, eb.best_uci,
                   eb.score_cp as best_score, ea.score_cp as after_score
            from move m
            join analysis_run r on r.id = m.run_id
            join eval_cache eb on eb.fen_key = m.before_key and eb.engine = r.engine and eb.depth = r.depth and eb.multipv = 1
            join eval_cache ea on ea.fen_key = m.after_key and ea.engine = r.engine and ea.depth = r.depth and ea.multipv = 1
            where m.run_id = ?
            """, (rs, i) -> new Scored(rs.getLong("id"), rs.getString("before_fen"),
                (Integer) rs.getObject("rating"), rs.getString("played_uci"), rs.getString("best_uci"),
                Cpl.compute(rs.getInt("best_score"), rs.getInt("after_score")), (Integer) rs.getObject("clock_cs")), run);

        for (Scored s : rows) {
            jdbc.update("""
                insert into move_analysis(move_id, cpl, best_uci) values (?, ?, ?)
                on conflict (move_id) do update set cpl = excluded.cpl, best_uci = excluded.best_uci
                """, s.moveId(), s.cpl(), s.bestUci());
        }
        for (int i = 0; i < rows.size(); i += MODEL_BATCH) {
            List<MoveIn> batch = new ArrayList<>();
            for (Scored s : rows.subList(i, Math.min(rows.size(), i + MODEL_BATCH))) {
                batch.add(new MoveIn(s.moveId(), s.fen(), s.rating(), s.playedUci(), s.bestUci(), s.cpl(), s.clockCs()));
            }
            for (MoveOut o : model.analyze(batch)) {
                jdbc.update(con -> {
                    var ps = con.prepareStatement("update move_analysis set p_played = ?, tags = ?, p_best = ? where move_id = ?");
                    ps.setDouble(1, o.pPlayed());
                    ps.setArray(2, con.createArrayOf("text", o.tags().toArray()));
                    ps.setObject(3, o.pBest(), java.sql.Types.DOUBLE);
                    ps.setLong(4, o.id());
                    return ps;
                });
            }
        }
        return rows.size();
    }

    /** Re-runs model scoring for the player's latest DONE run (idempotent). Empty when there is no such run. */
    public java.util.OptionalInt rescoreLatest(String username) {
        List<UUID> runs = jdbc.queryForList("""
            select id from analysis_run where lower(username) = lower(?) and status = 'DONE'
            order by created_at desc limit 1""", UUID.class, username);
        if (runs.isEmpty()) return java.util.OptionalInt.empty();
        return java.util.OptionalInt.of(score(runs.get(0)));
    }
}
