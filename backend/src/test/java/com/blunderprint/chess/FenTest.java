package com.blunderprint.chess;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class FenTest {
    @Test
    void keyDropsMoveCounters() {
        assertEquals("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
            Fen.key("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
    }

    @Test
    void forEngineAppendsCounters() {
        assertEquals("8/8/8/8/8/8/8/K6k w - - 0 1", Fen.forEngine("8/8/8/8/8/8/8/K6k w - -"));
    }
}
