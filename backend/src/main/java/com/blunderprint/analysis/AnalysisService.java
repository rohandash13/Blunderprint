package com.blunderprint.analysis;

import com.blunderprint.engine.EngineTracer;
import com.blunderprint.engine.Trace;
import com.blunderprint.model.ModelClient;
import com.blunderprint.model.ModelClient.MoveIn;
import com.blunderprint.model.ModelClient.MoveOut;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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

    private record Scored(long moveId, String fen, Integer rating, String playedUci, String bestUci, String bestPv,
                          int cpl, double winDrop, Integer clockCs) {}

    private record Candidate(long moveId, String beforeKey, String bestUci, boolean quiet, boolean freeMaterial) {}

    /** The best move must beat the second-best by this much win chance to count as an only move. */
    private static final double ONLY_MOVE_GAP = 0.10;

    private final JdbcTemplate jdbc;
    private final ModelClient model;
    private final ConcurrentHashMap<UUID, Integer> scoringFailures = new ConcurrentHashMap<>();

    private final EngineTracer tracer;
    private final double minPPlayed;

    public AnalysisService(JdbcTemplate jdbc, ModelClient model, EngineTracer tracer,
                           @Value("${report.min-p-played}") double minPPlayed) {
        this.jdbc = jdbc;
        this.model = model;
        this.tracer = tracer;
        this.minPPlayed = minPPlayed;
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
            select m.id, m.before_fen, m.rating, m.played_uci, m.clock_cs, eb.best_uci, eb.pv as best_pv,
                   eb.score_cp as best_score, ea.score_cp as after_score
            from move m
            join analysis_run r on r.id = m.run_id
            join eval_cache eb on eb.fen_key = m.before_key and eb.engine = r.engine and eb.depth = r.depth and eb.multipv = 1
            join eval_cache ea on ea.fen_key = m.after_key and ea.engine = r.engine and ea.depth = r.depth and ea.multipv = 1
            where m.run_id = ?
            """, (rs, i) -> new Scored(rs.getLong("id"), rs.getString("before_fen"),
                (Integer) rs.getObject("rating"), rs.getString("played_uci"), rs.getString("best_uci"),
                rs.getString("best_pv"),
                Cpl.compute(rs.getInt("best_score"), rs.getInt("after_score")),
                WinChance.drop(rs.getInt("best_score"), -rs.getInt("after_score")),
                (Integer) rs.getObject("clock_cs")), run);

        for (Scored s : rows) {
            jdbc.update("""
                insert into move_analysis(move_id, cpl, best_uci, win_drop) values (?, ?, ?, ?)
                on conflict (move_id) do update set cpl = excluded.cpl, best_uci = excluded.best_uci,
                    win_drop = excluded.win_drop
                """, s.moveId(), s.cpl(), s.bestUci(), s.winDrop());
        }
        for (int i = 0; i < rows.size(); i += MODEL_BATCH) {
            List<MoveIn> batch = new ArrayList<>();
            for (Scored s : rows.subList(i, Math.min(rows.size(), i + MODEL_BATCH))) {
                batch.add(new MoveIn(s.moveId(), s.fen(), s.rating(), s.playedUci(), s.bestUci(), s.bestPv(), s.cpl(),
                    s.clockCs()));
            }
            for (MoveOut o : model.analyze(batch)) {
                jdbc.update(con -> {
                    var ps = con.prepareStatement("update move_analysis set p_played = ?, tags = ?, p_best = ?, best_quiet = ?, best_free_material = ? where move_id = ?");
                    ps.setDouble(1, o.pPlayed());
                    ps.setArray(2, con.createArrayOf("text", o.tags().toArray()));
                    ps.setObject(3, o.pBest(), java.sql.Types.DOUBLE);
                    ps.setObject(4, o.bestQuiet(), java.sql.Types.BOOLEAN);
                    ps.setObject(5, o.bestFreeMaterial(), java.sql.Types.BOOLEAN);
                    ps.setLong(6, o.id());
                    return ps;
                });
            }
        }
        traceCandidates(run);
        return rows.size();
    }

    /**
     * Runs the MultiPV-2 trace for this run's candidate moves, sequentially, against each stored best move, and
     * stores difficulty. Rows of this run that were not traced successfully (non-candidates, failed or
     * disagreeing traces) end with null difficulty; traced rows are overwritten in place so a rescore never
     * leaves a report temporarily unrated.
     */
    private void traceCandidates(UUID run) {
        List<Candidate> candidates = jdbc.query("""
            select m.id, m.before_key, a.best_uci, coalesce(a.best_quiet, false) as quiet,
                   coalesce(a.best_free_material, false) as free
            from move m join move_analysis a on a.move_id = m.id
            where m.run_id = ? and %s
            """.formatted(Severity.CANDIDATE_SQL), (rs, i) -> new Candidate(rs.getLong("id"),
                rs.getString("before_key"), rs.getString("best_uci"), rs.getBoolean("quiet"),
                rs.getBoolean("free")), run, minPPlayed);
        List<Long> tracedIds = new ArrayList<>();
        int failures = 0;
        int disagreed = 0;
        for (Candidate c : candidates) {
            var trace = c.bestUci() == null ? java.util.Optional.<Trace>empty() : tracer.trace(c.beforeKey(), c.bestUci());
            if (trace.isEmpty()) { failures++; continue; }
            var t = trace.get();
            if (!t.targetIsBest()) {
                // The drilled move is not the engine's final choice (even as its second line, find_depth would
                // just be the final depth), so the trace says nothing reliable about it.
                disagreed++;
                continue;
            }
            boolean only = t.secondCp() != null
                && WinChance.of(t.bestCp()) - WinChance.of(t.secondCp()) >= ONLY_MOVE_GAP;
            int elo = DifficultyEstimator.estimate(t.findDepth(), c.freeMaterial(), c.quiet(), only);
            jdbc.update("update move_analysis set find_depth = ?, only_move = ?, difficulty_elo = ? where move_id = ?",
                t.findDepth(), only, elo, c.moveId());
            tracedIds.add(c.moveId());
        }
        jdbc.update(con -> {
            var ps = con.prepareStatement("""
                update move_analysis set find_depth = null, only_move = null, difficulty_elo = null
                where move_id in (select id from move where run_id = ?) and not (move_id = any (?))""");
            ps.setObject(1, run);
            ps.setArray(2, con.createArrayOf("bigint", tracedIds.toArray()));
            return ps;
        });
        log.info("run {}: traced {} of {} candidate moves ({} without a trace, {} trace disagreed)", run,
            tracedIds.size(), candidates.size(), failures, disagreed);
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
