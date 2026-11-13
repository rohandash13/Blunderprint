package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class UciParserTest {
    @Test
    void parsesCentipawnInfo() {
        var i = UciParser.parseInfo(
            "info depth 12 seldepth 18 multipv 1 score cp 34 nodes 1000 nps 500000 pv e2e4 e7e5 g1f3").orElseThrow();
        assertEquals(12, i.depth());
        assertEquals(34, i.cp());
        assertNull(i.mate());
        assertEquals("e2e4 e7e5 g1f3", i.pv());
    }

    @Test
    void parsesMateInfo() {
        var i = UciParser.parseInfo("info depth 5 multipv 1 score mate 1 pv a1a8").orElseThrow();
        assertEquals(1, i.mate());
        assertEquals(9999, UciParser.toCentipawns(i.cp(), i.mate()));
    }

    @Test
    void mateAgainstUsIsNegative() {
        assertEquals(-9998, UciParser.toCentipawns(null, -2));
        assertEquals(-10000, UciParser.toCentipawns(null, 0));
    }

    @Test
    void ignoresBoundsAndNonScoreLines() {
        assertTrue(UciParser.parseInfo("info depth 9 score cp 10 lowerbound pv e2e4").isEmpty());
        assertTrue(UciParser.parseInfo("info string NNUE evaluation using nn.nnue").isEmpty());
        assertTrue(UciParser.parseInfo("info depth 9 currmove e2e4 currmovenumber 1").isEmpty());
        assertTrue(UciParser.parseInfo("bestmove e2e4").isEmpty());
    }

    @Test
    void ignoresSecondaryPv() {
        assertTrue(UciParser.parseInfo("info depth 9 multipv 2 score cp 10 pv d2d4").isEmpty());
    }

    @Test
    void parseInfoAnyKeepsSecondaryPv() {
        var i = UciParser.parseInfoAny("info depth 9 multipv 2 score cp -10 pv d2d4 d7d5").orElseThrow();
        assertEquals(9, i.depth());
        assertEquals(2, i.multipv());
        assertEquals(-10, i.cp());
        assertNull(i.mate());
        assertEquals("d2d4 d7d5", i.pv());
        var m = UciParser.parseInfoAny("info depth 5 score mate 1 pv a1a8").orElseThrow();
        assertEquals(1, m.multipv());
        assertEquals(1, m.mate());
    }

    @Test
    void parseInfoAnyIgnoresBoundsAndNonScoreLines() {
        assertTrue(UciParser.parseInfoAny("info depth 9 multipv 2 score cp 10 upperbound pv e2e4").isEmpty());
        assertTrue(UciParser.parseInfoAny("info depth 9 score cp 10 lowerbound pv e2e4").isEmpty());
        assertTrue(UciParser.parseInfoAny("info string hello").isEmpty());
        assertTrue(UciParser.parseInfoAny("bestmove e2e4").isEmpty());
    }

    @Test
    void acceptsDepthZeroTerminalScore() {
        var i = UciParser.parseInfo("info depth 0 score mate 0").orElseThrow();
        assertEquals(-10000, UciParser.toCentipawns(i.cp(), i.mate()));
    }
}
