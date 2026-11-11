package com.blunderprint.engine;

import com.blunderprint.chess.Fen;
import com.github.bhlangonijr.chesslib.Board;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Live single-position analysis backed by the shared eval_cache. */
@Service
public class EngineService {
    public record Analysis(String bestUci, int scoreCp, List<String> pv) {}

    public interface Analyzer {
        EngineResult analyze(String fenKey, int depth) throws IOException;
    }

    private final JdbcTemplate jdbc;
    private final Analyzer analyzer;
    private final String engineVersion;
    private final int depth;

    public EngineService(JdbcTemplate jdbc, Analyzer analyzer,
                         @Value("${engine.version}") String engineVersion, @Value("${engine.depth}") int depth) {
        this.jdbc = jdbc;
        this.analyzer = analyzer;
        this.engineVersion = engineVersion;
        this.depth = depth;
    }

    /** @throws IllegalArgumentException for an invalid FEN; IOException if the engine fails. */
    public Analysis analyze(String fen) throws IOException {
        if (!validFen(fen)) throw new IllegalArgumentException("invalid FEN");
        String key = Fen.key(fen);
        var cached = lookup(key);
        if (cached != null) return cached;
        synchronized (this) {
            cached = lookup(key);
            if (cached != null) return cached;
            EngineResult r = analyzer.analyze(key, depth);
            jdbc.update("""
                insert into eval_cache (fen_key, engine, depth, multipv, best_uci, score_cp, pv)
                values (?, ?, ?, 1, ?, ?, ?) on conflict do nothing""",
                key, engineVersion, depth, r.bestUci(), r.scoreCp(), r.pv());
            return new Analysis(r.bestUci(), r.scoreCp(), splitPv(r.pv()));
        }
    }

    private Analysis lookup(String key) {
        return jdbc.query("""
            select best_uci, score_cp, pv from eval_cache
            where fen_key = ? and engine = ? and depth = ? and multipv = 1""",
            (rs, i) -> new Analysis(rs.getString("best_uci"), rs.getInt("score_cp"), splitPv(rs.getString("pv"))),
            key, engineVersion, depth).stream().findFirst().orElse(null);
    }

    private static List<String> splitPv(String pv) {
        if (pv == null || pv.isBlank()) return List.of();
        return List.of(pv.trim().split("\s+"));
    }

    static boolean validFen(String fen) {
        if (fen == null || fen.trim().split("\s+").length != 6) return false;
        try {
            new Board().loadFromFen(fen.trim());
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
