package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

@EnabledIfEnvironmentVariable(named = "STOCKFISH_PATH", matches = ".+")
class StockfishEngineIT {
    @Test
    void findsBackRankMateInOne() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            EngineResult r = sf.analyze("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -", 8);
            assertEquals("a1a8", r.bestUci());
            assertEquals(9999, r.scoreCp());
        }
    }

    @Test
    void terminalPositionHasNoBestMove() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            // Black is checkmated (back-rank).
            EngineResult r = sf.analyze("R5k1/5ppp/8/8/8/8/5PPP/6K1 b - -", 8);
            assertNull(r.bestUci());
            assertEquals(-10000, r.scoreCp());
        }
    }
}
