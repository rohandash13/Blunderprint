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
            Trace t = sf.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", 14, "e4d5");
            assertEquals("e4d5", t.bestUci());
            assertTrue(t.targetIsBest());
            assertTrue(t.findDepth() <= 2, "findDepth=" + t.findDepth());
            assertNotNull(t.secondCp());
            assertTrue(t.bestCp() > t.secondCp());
        }
    }

    @Test
    void traceDescribesTheTargetNotTheEngineChoice() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            // Capturing the queen is clearly best; asking about a quiet king move must say it is not best.
            Trace t = sf.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", 14, "e1f1");
            assertEquals("e4d5", t.bestUci());
            assertFalse(t.targetIsBest());
            assertEquals(14, t.findDepth());      // the target never led, so it is "found" only at the final depth
            // The same position traced against the capture agrees with the engine from the first depths.
            Trace best = sf.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", 14, t.bestUci());
            assertTrue(best.targetIsBest());
            assertTrue(best.findDepth() <= t.findDepth());
        }
    }

    @Test
    void traceStartPositionHasSecondLineAndEngineStaysUsable() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            Trace t = sf.trace("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", 10, "e2e4");
            assertNotNull(t.secondCp());
            assertTrue(t.findDepth() >= 1 && t.findDepth() <= 10);
            // MultiPV restored to 1: normal analyze still works.
            EngineResult r = sf.analyze("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -", 8);
            assertEquals("a1a8", r.bestUci());
        }
    }

    @Test
    void traceIsDeterministicAcrossInterleavedSearches() throws Exception {
        String fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq -";
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            Trace a = sf.trace(fen, 14, "h5f7");
            sf.trace("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", 12, "e2e4");
            Trace b = sf.trace(fen, 14, "h5f7");
            assertEquals(a.findDepth(), b.findDepth());
            assertEquals(a.bestUci(), b.bestUci());
            assertEquals(a.bestCp(), b.bestCp());
        }
    }

    @Test
    void tracerReturnsEmptyForTerminalWithoutLosingEngine() {
        var tracer = new EngineTracer(System.getenv("STOCKFISH_PATH"));
        try {
            assertTrue(tracer.trace("R5k1/5ppp/8/8/8/8/5PPP/6K1 b - -", "g8h8").isEmpty());
            assertTrue(tracer.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", "e4d5").isPresent());
        } finally {
            tracer.shutdown();
        }
    }

    @Test
    void tracerWithMissingBinaryReturnsEmptyRepeatedly() {
        var tracer = new EngineTracer("C:/no/such/stockfish.exe");
        assertTrue(tracer.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", "e4d5").isEmpty());
        assertTrue(tracer.trace("4k3/8/8/3q4/4P3/8/8/4K3 w - -", "e4d5").isEmpty());
    }

    @Test
    void traceSingleLegalMoveHasNullSecond() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            // Ka1 checked by Rh1, Rb8 covers the b-file: Ka2 is the only legal move.
            Trace t = sf.trace("1r5k/8/8/8/8/8/8/K6r w - -", 8, "a1a2");
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
