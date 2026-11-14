package com.blunderprint.report;

import com.blunderprint.analysis.Severity;
import com.blunderprint.lichess.LichessClient;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** The player profile that opens the coach: ratings, record, phases, kinds, clock, recent-games grid, patterns. */
@Service
public class ProfileService {
    static final int GRID_GAMES = 40;
    static final int OPENING_PLIES = 20;
    static final int ENDGAME_MAX_PIECES = 4;
    static final int UNDER_THIRTY_CS = 3000;

    public record Analyzed(int games, int moves, Instant from, Instant to) {}
    public record Wdl(int w, int d, int l) {}
    public record GameRecord(Wdl white, Wdl black) {}
    public record Phases(double opening, double middlegame, double endgame) {}
    public record PhaseMoves(int opening, int middlegame, int endgame) {}
    public record Kinds(int positional, int tactical) {}
    public record Clock(double underThirtyShare, double mistakeRateUnder30, double mistakeRateOver30) {}
    public record Mark(int ply, String pattern, String level, String kind, double winDrop) {}
    public record GridGame(String gameId, Instant playedAt, String color, String result, List<Mark> marks) {}
    public record Levels(int slip, int tricky, int deep, int unrated) {}
    public record PatternStat(String tag, int count, Instant lastSeen, Levels levels, Kinds kinds) {}
    public record Profile(String username, Map<String, LichessClient.Perf> ratings, Analyzed analyzed,
                          GameRecord record, Phases phases, PhaseMoves phaseMoves, Kinds kinds, Clock clock, List<GridGame> grid,
                          List<PatternStat> patterns) {}

    private final JdbcTemplate jdbc;
    private final ReportService reports;
    private final LichessClient lichess;

    public ProfileService(JdbcTemplate jdbc, ReportService reports, LichessClient lichess) {
        this.jdbc = jdbc;
        this.reports = reports;
        this.lichess = lichess;
    }

    /** One of the player's analyzed moves with the facts the profile needs. */
    private record Row(String gameId, int ply, String fen, Integer clockCs, boolean candidate, String pattern,
                       String level, String kind, double winDrop, Instant playedAt, String color, String result) {}

    static int nonPawnPieces(String fen) {
        int n = 0;
        String board = fen.trim().split("\\s+")[0];
        for (char ch : board.toCharArray()) if ("nbrqNBRQ".indexOf(ch) >= 0) n++;
        return n;
    }

    static String phase(int ply, String fen) {
        if (ply < OPENING_PLIES) return "opening";
        return nonPawnPieces(fen) <= ENDGAME_MAX_PIECES ? "endgame" : "middlegame";
    }

    private static double per100(int part, int whole) {
        return whole == 0 ? 0.0 : part * 100.0 / whole;
    }

    /** "w" | "d" | "l" from the player's side, null when the result is unknown. */
    private static String outcome(String result, String color) {
        if (result == null) return null;
        return switch (result) {
            case "1/2-1/2" -> "d";
            case "1-0" -> color.equals("white") ? "w" : "l";
            case "0-1" -> color.equals("black") ? "w" : "l";
            default -> null;
        };
    }

    public Optional<Profile> profile(String username) {
        Optional<UUID> maybe = reports.latestDoneRun(username);
        if (maybe.isEmpty()) return Optional.empty();
        UUID run = maybe.get();

        List<Row> rows = jdbc.query("""
            select m.game_id, m.ply, m.before_fen, m.clock_cs, a.tags, a.win_drop, a.best_quiet, g.black,
                   coalesce(%s, false) as cand, %s as level, g.played_at, g.white, g.result, m.mover
            from move m join move_analysis a on a.move_id = m.id join game g on g.id = m.game_id
            where m.run_id = ?
            order by g.played_at, m.game_id, m.ply
            """.formatted("(" + Severity.CANDIDATE_SQL + ")", reports.levelSql()), (rs, i) -> {
                Timestamp t = rs.getTimestamp("played_at");
                String white = rs.getString("white");
                String color = username.equalsIgnoreCase(white) ? "white"
                    : username.equalsIgnoreCase(rs.getString("black")) ? "black"
                    : "w".equals(rs.getString("mover")) ? "white" : "black";
                Double wd = (Double) rs.getObject("win_drop");
                return new Row(rs.getString("game_id"), rs.getInt("ply"), rs.getString("before_fen"),
                    (Integer) rs.getObject("clock_cs"), rs.getBoolean("cand"),
                    ReportService.primaryPattern(ReportService.tagsOf(rs)), rs.getString("level"),
                    ReportService.kind((Boolean) rs.getObject("best_quiet")), wd == null ? 0.0 : wd,
                    t == null ? null : t.toInstant(), color, rs.getString("result"));
            }, reports.minP(), run);

        Map<String, List<Row>> byGame = new LinkedHashMap<>();   // in the order the games were played
        for (Row r : rows) byGame.computeIfAbsent(r.gameId(), k -> new ArrayList<>()).add(r);

        int[][] rec = new int[2][3];   // [white|black][w,d,l]
        Instant from = null, to = null;
        for (List<Row> g : byGame.values()) {
            Row f = g.get(0);
            String o = outcome(f.result(), f.color());
            if (o != null) rec[f.color().equals("white") ? 0 : 1][o.equals("w") ? 0 : o.equals("d") ? 1 : 2]++;
            if (f.playedAt() != null) {
                if (from == null || f.playedAt().isBefore(from)) from = f.playedAt();
                if (to == null || f.playedAt().isAfter(to)) to = f.playedAt();
            }
        }

        Map<String, int[]> phases = new HashMap<>();    // phase -> [moves, candidates]
        int positional = 0, tactical = 0;
        int clockKnown = 0, under = 0, underCand = 0, overCand = 0;
        for (Row r : rows) {
            int[] p = phases.computeIfAbsent(phase(r.ply(), r.fen()), k -> new int[2]);
            p[0]++;
            if (r.candidate()) {
                p[1]++;
                if (r.kind().equals("positional")) positional++; else tactical++;
            }
            if (r.clockCs() != null) {
                clockKnown++;
                if (r.clockCs() < UNDER_THIRTY_CS) {
                    under++;
                    if (r.candidate()) underCand++;
                } else if (r.candidate()) {
                    overCand++;
                }
            }
        }
        int[] none = new int[2];
        int[] op = phases.getOrDefault("opening", none), mid = phases.getOrDefault("middlegame", none),
            end = phases.getOrDefault("endgame", none);

        // Grid: the 40 most recent analyzed games, oldest to newest; candidates only, primary pattern.
        List<List<Row>> games = new ArrayList<>(byGame.values());
        List<GridGame> grid = new ArrayList<>();
        games.removeIf(g -> g.get(0).playedAt() == null);   // undated games cannot be placed in the timeline
        for (List<Row> g : games.subList(Math.max(0, games.size() - GRID_GAMES), games.size())) {
            Row f = g.get(0);
            List<Mark> marks = g.stream().filter(Row::candidate)
                .map(r -> new Mark(r.ply(), r.pattern(), r.level(), r.kind(), r.winDrop())).toList();
            grid.add(new GridGame(f.gameId(), f.playedAt(), f.color(), outcome(f.result(), f.color()), marks));
        }

        Map<String, List<Row>> byPattern = new LinkedHashMap<>();
        for (Row r : rows) if (r.candidate()) byPattern.computeIfAbsent(r.pattern(), k -> new ArrayList<>()).add(r);
        List<PatternStat> patterns = new ArrayList<>();
        for (var e : byPattern.entrySet()) {
            List<Row> rs = e.getValue();
            Instant last = rs.stream().map(Row::playedAt).filter(Objects::nonNull).max(Comparator.naturalOrder())
                .orElse(null);
            int pos = (int) rs.stream().filter(r -> r.kind().equals("positional")).count();
            patterns.add(new PatternStat(e.getKey(), rs.size(), last,
                new Levels(lv(rs, "slip"), lv(rs, "tricky"), lv(rs, "deep"), lv(rs, "unrated")),
                new Kinds(pos, rs.size() - pos)));
        }
        patterns.sort(Comparator.comparingInt(PatternStat::count).reversed().thenComparing(PatternStat::tag));

        return Optional.of(new Profile(username, lichess.fetchUser(username),
            new Analyzed(byGame.size(), rows.size(), from, to),
            new GameRecord(new Wdl(rec[0][0], rec[0][1], rec[0][2]), new Wdl(rec[1][0], rec[1][1], rec[1][2])),
            new Phases(per100(op[1], op[0]), per100(mid[1], mid[0]), per100(end[1], end[0])),
            new PhaseMoves(op[0], mid[0], end[0]),
            new Kinds(positional, tactical),
            new Clock(clockKnown == 0 ? 0.0 : (double) under / clockKnown, per100(underCand, under),
                per100(overCand, clockKnown - under)),
            grid, patterns));
    }

    private static int lv(List<Row> rows, String level) {
        return (int) rows.stream().filter(r -> r.level().equals(level)).count();
    }

    /** One of the player's analyzed positions from their latest finished run, as a drill example. */
    public Optional<ReportService.Example> position(String username, String gameId, int ply) {
        Optional<UUID> run = reports.latestDoneRun(username);
        if (run.isEmpty()) return Optional.empty();
        List<ReportService.Example> found = jdbc.query("""
            select m.game_id, m.ply, m.before_fen, m.played_uci, m.clock_cs, a.best_uci, a.cpl, a.p_played, a.win_drop,
                   a.best_quiet, a.difficulty_elo, c.pv, %s as level
            from move m join move_analysis a on a.move_id = m.id
            join analysis_run r on r.id = m.run_id
            left join eval_cache c on c.fen_key = m.before_key and c.engine = r.engine
                                  and c.depth = r.depth and c.multipv = 1
            where m.run_id = ? and m.game_id = ? and m.ply = ?
            """.formatted(reports.levelSql()), (rs, i) -> ReportService.exampleOf(rs), run.get(), gameId, ply);
        return found.stream().findFirst();
    }
}
