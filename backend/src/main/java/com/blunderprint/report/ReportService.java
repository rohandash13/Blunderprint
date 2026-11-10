package com.blunderprint.report;

import java.sql.Array;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    public record Example(String gameId, int ply, String fen, String played, String best, int cpl, double pPlayed) {}
    public record PatternSummary(String tag, int count, double avgCpl, List<Example> examples) {}
    public record Report(String username, UUID runId, int movesAnalyzed, int mistakes, int candidates,
                         List<PatternSummary> patterns) {}
    public record MistakeRow(String gameId, long playedAtEpochSec, int ply, int cpl, Double pPlayed, List<String> tags) {}

    private final JdbcTemplate jdbc;
    private final int mistakeCpl;
    private final double minP;

    public ReportService(JdbcTemplate jdbc, @Value("${report.mistake-cpl}") int mistakeCpl,
                         @Value("${report.min-p-played}") double minP) {
        this.jdbc = jdbc;
        this.mistakeCpl = mistakeCpl;
        this.minP = minP;
    }

    private Optional<UUID> latestDoneRun(String username) {
        List<UUID> ids = jdbc.queryForList("""
            select id from analysis_run where lower(username) = lower(?) and status = 'DONE'
            order by created_at desc limit 1""", UUID.class, username);
        return ids.stream().findFirst();
    }

    public Optional<Report> report(String username) {
        Optional<UUID> maybe = latestDoneRun(username);
        if (maybe.isEmpty()) return Optional.empty();
        UUID run = maybe.get();
        var counts = jdbc.queryForMap("""
            select count(*) moves,
                   count(*) filter (where a.cpl >= ?) mistakes,
                   count(*) filter (where a.cpl >= ? and a.p_played >= ?) candidates
            from move m join move_analysis a on a.move_id = m.id where m.run_id = ?
            """, mistakeCpl, mistakeCpl, minP, run);

        Map<String, List<Example>> byTag = new LinkedHashMap<>();
        Map<String, double[]> stats = new HashMap<>();     // tag -> [count, sumCpl]
        jdbc.query("""
            select tag, m.game_id, m.ply, m.before_fen, m.played_uci, a.best_uci, a.cpl, a.p_played
            from move m join move_analysis a on a.move_id = m.id, unnest(a.tags) as tag
            where m.run_id = ? and a.cpl >= ? and a.p_played >= ?
            order by a.cpl desc
            """, rs -> {
                String tag = rs.getString("tag");
                stats.computeIfAbsent(tag, t -> new double[2]);
                stats.get(tag)[0] += 1;
                stats.get(tag)[1] += rs.getInt("cpl");
                List<Example> ex = byTag.computeIfAbsent(tag, t -> new ArrayList<>());
                if (ex.size() < 3) {
                    ex.add(new Example(rs.getString("game_id"), rs.getInt("ply"), rs.getString("before_fen"),
                        rs.getString("played_uci"), rs.getString("best_uci"), rs.getInt("cpl"), rs.getDouble("p_played")));
                }
            }, run, mistakeCpl, minP);

        List<PatternSummary> patterns = new ArrayList<>();
        for (var e : stats.entrySet()) {
            patterns.add(new PatternSummary(e.getKey(), (int) e.getValue()[0], e.getValue()[1] / e.getValue()[0],
                byTag.get(e.getKey())));
        }
        patterns.sort(Comparator.comparingInt(PatternSummary::count).reversed());
        return Optional.of(new Report(username, run, ((Number) counts.get("moves")).intValue(),
            ((Number) counts.get("mistakes")).intValue(), ((Number) counts.get("candidates")).intValue(), patterns));
    }

    public List<MistakeRow> mistakes(String username) {
        return latestDoneRun(username).map(run -> jdbc.query("""
            select m.game_id, extract(epoch from g.played_at)::bigint as t, m.ply, a.cpl, a.p_played, a.tags
            from move m join move_analysis a on a.move_id = m.id join game g on g.id = m.game_id
            where m.run_id = ? order by g.played_at, m.ply
            """, (rs, i) -> {
                Array arr = rs.getArray("tags");
                List<String> tags = arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
                return new MistakeRow(rs.getString("game_id"), rs.getLong("t"), rs.getInt("ply"), rs.getInt("cpl"),
                    (Double) rs.getObject("p_played"), tags);
            }, run)).orElse(List.of());
    }
}
