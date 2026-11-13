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
    void traceFindsFreeQueenImmediately() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            Trace t = sf.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", 14);
            assertEquals("e4d5", t.bestUci());
            assertTrue(t.findDepth() <= 2, "findDepth=" + t.findDepth());
            assertNotNull(t.secondCp());
            assertTrue(t.bestCp() > t.secondCp());
        }
    }

    @Test
    void traceStartPositionHasSecondLineAndEngineStaysUsable() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            Trace t = sf.trace("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", 10);
            assertNotNull(t.secondCp());
            assertTrue(t.findDepth() >= 1 && t.findDepth() <= 10);
            // MultiPV restored to 1: normal analyze still works.
            EngineResult r = sf.analyze("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -", 8);
            assertEquals("a1a8", r.bestUci());
        }
    }

    @Test
    void traceSingleLegalMoveHasNullSecond() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            // Ka1 checked by Rh1, Rb8 covers the b-file: Ka2 is the only legal move.
            Trace t = sf.trace("1r5k/8/8/8/8/8/8/K6r w - -", 8);
            assertEquals("a1a2", t.bestUci());
            assertNull(t.secondCp());
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
