package com.blunderprint.report;

import static com.blunderprint.analysis.Severity.*;

import com.blunderprint.analysis.Severity;
import java.sql.Array;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    public record Example(String gameId, int ply, String fen, String played, String best, int cpl, double pPlayed,
                           List<String> pv, String level, String kind, String severity, Integer difficultyElo) {}
    public record PatternSummary(String tag, int count, double avgCpl, List<Example> examples) {}
    public record Report(String username, UUID runId, int movesAnalyzed, int mistakes, int candidates,
                         List<PatternSummary> patterns, List<String> levels, Map<String, Integer> levelCounts) {}
    public record MistakeRow(String gameId, long playedAtEpochSec, int ply, int cpl, Double pPlayed, List<String> tags,
                             Double pBest, Double winDrop, String kind, String severity, Integer difficultyElo,
                             String level) {}

    /** Primary-pattern priority: a move is listed under the first of these it carries. */
    static final List<String> PATTERN_PRIORITY = List.of("time_trouble", "missed_tactic", "hanging_piece",
        "positional", "endgame_technique", "opening_error");
    static final String OTHER = "other";

    private final JdbcTemplate jdbc;
    private final double minP;
    private final Difficulty difficulty;

    public ReportService(JdbcTemplate jdbc, @Value("${report.min-p-played}") double minP,
                         @Value("${report.levels.slip-below:300}") int slipBelow,
                         @Value("${report.levels.deep-above:100}") int deepAbove) {
        this.jdbc = jdbc;
        this.minP = minP;
        this.difficulty = new Difficulty(slipBelow, deepAbove);
    }

    static String primaryPattern(List<String> tags) {
        for (String t : PATTERN_PRIORITY) if (tags.contains(t)) return t;
        return OTHER;
    }

    static String severity(double winDrop) {
        return winDrop >= BLUNDER ? "blunder" : winDrop >= MISTAKE ? "mistake" : "inaccuracy";
    }

    private static String kind(Boolean bestQuiet) {
        return Boolean.TRUE.equals(bestQuiet) ? "positional" : "tactical";
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

    private static List<String> tagsOf(java.sql.ResultSet rs) throws java.sql.SQLException {
        Array arr = rs.getArray("tags");
        return arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
    }

    /** One candidate move with its primary pattern, ready for filtering. */
    private record Cand(String tag, String level, Example example) {}

    public Optional<Report> report(String username) {
        return report(username, Difficulty.DEFAULT);
    }

    public Optional<Report> report(String username, List<String> levels) {
        Optional<UUID> maybe = latestDoneRun(username);
        if (maybe.isEmpty()) return Optional.empty();
        UUID run = maybe.get();
        var counts = jdbc.queryForMap("""
            select count(*) moves,
                   count(*) filter (where a.win_drop >= ?) mistakes,
                   count(*) filter (where %s) candidates
            from move m join move_analysis a on a.move_id = m.id where m.run_id = ?
            """.formatted(Severity.CANDIDATE_SQL), MISTAKE, minP, run);

        String lvl = difficulty.sqlLevel("a.difficulty_elo", "m.rating");
        List<Cand> cands = jdbc.query("""
            select m.game_id, m.ply, m.before_fen, m.played_uci, a.best_uci, a.cpl, a.p_played, a.tags, a.win_drop,
                   a.best_quiet, a.difficulty_elo, c.pv, %s as level
            from move m join move_analysis a on a.move_id = m.id
            join analysis_run r on r.id = m.run_id
            left join eval_cache c on c.fen_key = m.before_key and c.engine = r.engine
                                  and c.depth = r.depth and c.multipv = 1
            where m.run_id = ? and %s
            order by a.win_drop desc, m.game_id, m.ply
            """.formatted(lvl, Severity.CANDIDATE_SQL), (rs, i) -> {
                double wd = rs.getDouble("win_drop");
                String level = rs.getString("level");
                Integer elo = (Integer) rs.getObject("difficulty_elo");
                Example ex = new Example(rs.getString("game_id"), rs.getInt("ply"), rs.getString("before_fen"),
                    rs.getString("played_uci"), rs.getString("best_uci"), rs.getInt("cpl"), rs.getDouble("p_played"),
                    splitPv(rs.getString("pv")), level, kind((Boolean) rs.getObject("best_quiet")), severity(wd), elo);
                return new Cand(primaryPattern(tagsOf(rs)), level, ex);
            }, run, minP);

        // When no candidate in the run has an estimate yet, show unrated ones rather than nothing.
        List<String> effective = new ArrayList<>(levels);
        // Clock candidates are not level-filtered, so only the others decide whether levels exist at all.
        List<Cand> levelled = cands.stream().filter(c -> !c.tag().equals("time_trouble")).toList();
        boolean allUnrated = !levelled.isEmpty() && levelled.stream().allMatch(c -> c.level().equals("unrated"));
        if (allUnrated && !effective.contains("unrated")) effective.add("unrated");
        boolean clockExamples = effective.contains("slip");

        // Clock (time_trouble) candidates only ever yield examples under the slip filter, so they only count
        // toward the level chips then; otherwise a chip could promise positions that are not there.
        Map<String, Integer> levelCounts = new LinkedHashMap<>();
        for (String l : Difficulty.ALL) levelCounts.put(l, 0);
        for (Cand c : cands) {
            if (c.tag().equals("time_trouble") && !clockExamples) continue;
            levelCounts.merge(c.level(), 1, Integer::sum);
        }

        Map<String, List<Example>> examples = new LinkedHashMap<>();
        Map<String, double[]> stats = new HashMap<>();     // tag -> [count, sumCpl]
        for (Cand c : cands) {                              // already ordered by win_drop desc, game, ply
            boolean clock = c.tag().equals("time_trouble");
            // Clock errors always count toward their pattern; other patterns follow the level filter.
            if (!clock && !effective.contains(c.level())) continue;
            double[] st = stats.computeIfAbsent(c.tag(), t -> new double[2]);
            st[0] += 1;
            st[1] += c.example().cpl();
            List<Example> ex = examples.computeIfAbsent(c.tag(), t -> new ArrayList<>());
            boolean eligible = !clock || (clockExamples && effective.contains(c.level()));
            if (eligible && ex.size() < 3) ex.add(c.example());
        }

        List<PatternSummary> patterns = new ArrayList<>();
        for (var e : stats.entrySet()) {
            patterns.add(new PatternSummary(e.getKey(), (int) e.getValue()[0], e.getValue()[1] / e.getValue()[0],
                examples.get(e.getKey())));
        }
        patterns.sort(Comparator.comparingInt(PatternSummary::count).reversed()
            .thenComparing(Comparator.comparingDouble(PatternSummary::avgCpl).reversed())
            .thenComparing(PatternSummary::tag));
        return Optional.of(new Report(username, run, ((Number) counts.get("moves")).intValue(),
            ((Number) counts.get("mistakes")).intValue(), ((Number) counts.get("candidates")).intValue(), patterns,
            levels, levelCounts));
    }

    public List<MistakeRow> mistakes(String username) {
        return latestDoneRun(username).map(this::mistakes).orElse(List.of());
    }

    private List<MistakeRow> mistakes(UUID run) {
        return jdbc.query("""
            select m.game_id, extract(epoch from g.played_at)::bigint as t, m.ply, a.cpl, a.p_played, a.tags, a.p_best,
                   a.win_drop, a.best_quiet, a.difficulty_elo, m.rating
            from move m join move_analysis a on a.move_id = m.id join game g on g.id = m.game_id
            where m.run_id = ? order by g.played_at, m.ply
            """, (rs, i) -> {
                Double pBest = (Double) rs.getObject("p_best");
                Double pPlayed = (Double) rs.getObject("p_played");
                Double winDrop = (Double) rs.getObject("win_drop");
                Boolean quiet = (Boolean) rs.getObject("best_quiet");
                Integer elo = (Integer) rs.getObject("difficulty_elo");
                Integer rating = (Integer) rs.getObject("rating");
                boolean candidate = winDrop != null && winDrop >= INACCURACY && pPlayed != null && pPlayed >= minP
                    && (winDrop >= MISTAKE || Boolean.TRUE.equals(quiet));
                return new MistakeRow(rs.getString("game_id"), rs.getLong("t"), rs.getInt("ply"), rs.getInt("cpl"),
                    pPlayed, tagsOf(rs), pBest, winDrop, kind(quiet),
                    winDrop != null && winDrop >= INACCURACY ? severity(winDrop) : null, elo,
                    candidate ? difficulty.level(elo, rating) : null);
            }, run);
    }
}
