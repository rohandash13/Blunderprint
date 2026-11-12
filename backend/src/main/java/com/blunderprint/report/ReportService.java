package com.blunderprint.report;

import java.sql.Array;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    public record Example(String gameId, int ply, String fen, String played, String best, int cpl, double pPlayed,
                           List<String> pv, Double pBest, String level) {}
    public record PatternSummary(String tag, int count, double avgCpl, List<Example> examples) {}
    public record Report(String username, UUID runId, int movesAnalyzed, int mistakes, int candidates,
                         List<PatternSummary> patterns, List<String> levels, Map<String, Integer> levelCounts) {}
    public record MistakeRow(String gameId, long playedAtEpochSec, int ply, int cpl, Double pPlayed, List<String> tags,
                             Double pBest, String level) {}

    private final JdbcTemplate jdbc;
    private final int mistakeCpl;
    private final double minP;
    private final Difficulty difficulty;

    public ReportService(JdbcTemplate jdbc, @Value("${report.mistake-cpl}") int mistakeCpl,
                         @Value("${report.min-p-played}") double minP, Difficulty difficulty) {
        this.jdbc = jdbc;
        this.difficulty = difficulty;
        this.mistakeCpl = mistakeCpl;
        this.minP = minP;
    }

    private Optional<UUID> latestDoneRun(String username) {
        List<UUID> ids = jdbc.queryForList("""
            select id from analysis_run where lower(username) = lower(?) and status = 'DONE'
            order by created_at desc limit 1""", UUID.class, username);
        return ids.stream().findFirst();
    }

    private static List<String> splitPv(String pv) {
        if (pv == null || pv.isBlank()) return List.of();
        return List.of(pv.trim().split("\\s+"));
    }

    public Optional<Report> report(String username) {
        return report(username, Difficulty.DEFAULT);
    }

    public Optional<Report> report(String username, List<String> levels) {
        Optional<UUID> maybe = latestDoneRun(username);
        if (maybe.isEmpty()) return Optional.empty();
        UUID run = maybe.get();
        var counts = jdbc.queryForMap("""
            select count(*) moves,
                   count(*) filter (where a.cpl >= ?) mistakes,
                   count(*) filter (where a.cpl >= ? and a.p_played >= ?) candidates
            from move m join move_analysis a on a.move_id = m.id where m.run_id = ?
            """, mistakeCpl, mistakeCpl, minP, run);

        String lvl = Difficulty.sqlLevel("a.p_best");
        Map<String, Integer> levelCounts = new LinkedHashMap<>();
        for (String l : Difficulty.ALL) levelCounts.put(l, 0);
        jdbc.query("select " + lvl + " as level, count(*) n from move m join move_analysis a on a.move_id = m.id "
                + "where m.run_id = ? and a.cpl >= ? and a.p_played >= ? group by 1",
            rs -> { levelCounts.put(rs.getString("level"), rs.getInt("n")); },
            difficulty.slipMin(), difficulty.deepMax(), run, mistakeCpl, minP);

        String in = String.join(",", Collections.nCopies(levels.size(), "?"));
        List<Object> params = new ArrayList<>(List.of(difficulty.slipMin(), difficulty.deepMax(), run, mistakeCpl, minP,
            difficulty.slipMin(), difficulty.deepMax()));
        params.addAll(levels);

        Map<String, List<Example>> byTag = new LinkedHashMap<>();
        Map<String, double[]> stats = new HashMap<>();     // tag -> [count, sumCpl]
        jdbc.query("""
            select tag, m.game_id, m.ply, m.before_fen, m.played_uci, a.best_uci, a.cpl, a.p_played, a.p_best, c.pv,
                   %s as level
            from move m join move_analysis a on a.move_id = m.id
            join analysis_run r on r.id = m.run_id
            left join eval_cache c on c.fen_key = m.before_key and c.engine = r.engine
                                  and c.depth = r.depth and c.multipv = 1,
                 unnest(a.tags) as tag
            where m.run_id = ? and a.cpl >= ? and a.p_played >= ? and %s in (%s)
            order by a.cpl * (1 - coalesce(a.p_best, 0.5)) desc, a.cpl desc, m.game_id, m.ply
            """.formatted(lvl, lvl, in), rs -> {
                String tag = rs.getString("tag");
                stats.computeIfAbsent(tag, t -> new double[2]);
                stats.get(tag)[0] += 1;
                stats.get(tag)[1] += rs.getInt("cpl");
                List<Example> ex = byTag.computeIfAbsent(tag, t -> new ArrayList<>());
                if (ex.size() < 3) {
                    ex.add(new Example(rs.getString("game_id"), rs.getInt("ply"), rs.getString("before_fen"),
                        rs.getString("played_uci"), rs.getString("best_uci"), rs.getInt("cpl"), rs.getDouble("p_played"),
                        splitPv(rs.getString("pv")), (Double) rs.getObject("p_best"), rs.getString("level")));
                }
            }, params.toArray());

        List<PatternSummary> patterns = new ArrayList<>();
        for (var e : stats.entrySet()) {
            patterns.add(new PatternSummary(e.getKey(), (int) e.getValue()[0], e.getValue()[1] / e.getValue()[0],
                byTag.get(e.getKey())));
        }
        patterns.sort(Comparator.comparingInt(PatternSummary::count).reversed()
            .thenComparing(Comparator.comparingDouble(PatternSummary::avgCpl).reversed())
            .thenComparing(PatternSummary::tag));
        return Optional.of(new Report(username, run, ((Number) counts.get("moves")).intValue(),
            ((Number) counts.get("mistakes")).intValue(), ((Number) counts.get("candidates")).intValue(), patterns,
            levels, levelCounts));
    }

    public List<MistakeRow> mistakes(String username) {
        return latestDoneRun(username).map(run -> jdbc.query("""
            select m.game_id, extract(epoch from g.played_at)::bigint as t, m.ply, a.cpl, a.p_played, a.tags, a.p_best
            from move m join move_analysis a on a.move_id = m.id join game g on g.id = m.game_id
            where m.run_id = ? order by g.played_at, m.ply
            """, (rs, i) -> {
                Array arr = rs.getArray("tags");
                List<String> tags = arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
                Double pBest = (Double) rs.getObject("p_best");
                return new MistakeRow(rs.getString("game_id"), rs.getLong("t"), rs.getInt("ply"), rs.getInt("cpl"),
                    (Double) rs.getObject("p_played"), tags, pBest, difficulty.level(pBest));
            }, run)).orElse(List.of());
    }
}
