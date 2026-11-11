package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.chess.Fen;
import java.util.List;
import org.junit.jupiter.api.Test;

class EngineServiceIT extends PostgresIT {
    private static final String FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    private static final String ENGINE = "sf-test";
    private static final int DEPTH = 12;

    private EngineService service(EngineService.Analyzer a) {
        return new EngineService(jdbc, a, ENGINE, DEPTH);
    }

    @Test
    void cacheHitDoesNotTouchEngine() throws Exception {
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values (?, ?, ?, 1, 'e2e4', 30, 'e2e4 e7e5')",
            Fen.key(FEN), ENGINE, DEPTH);
        var r = service((k, d) -> { throw new AssertionError("engine must not be called"); }).analyze(FEN);
        assertEquals("e2e4", r.bestUci());
        assertEquals(30, r.scoreCp());
        assertEquals(List.of("e2e4", "e7e5"), r.pv());
    }

    @Test
    void missAnalyzesAndStores() throws Exception {
        var r = service((k, d) -> {
            assertEquals(Fen.key(FEN), k);
            assertEquals(DEPTH, d);
            return new EngineResult("g1f3", 25, "g1f3 g8f6");
        }).analyze(FEN);
        assertEquals("g1f3", r.bestUci());
        assertEquals(25, r.scoreCp());
        assertEquals(List.of("g1f3", "g8f6"), r.pv());
        Integer n = jdbc.queryForObject("select count(*) from eval_cache where fen_key = ? and engine = ? and depth = ? and multipv = 1",
            Integer.class, Fen.key(FEN), ENGINE, DEPTH);
        assertEquals(1, n);
    }

    @Test
    void invalidFenRejected() {
        var s = service((k, d) -> { throw new AssertionError("engine must not be called"); });
        assertThrows(IllegalArgumentException.class, () -> s.analyze("not a fen"));
        assertThrows(IllegalArgumentException.class, () -> s.analyze(null));
    }
}
