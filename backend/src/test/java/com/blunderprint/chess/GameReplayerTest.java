package com.blunderprint.chess;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class GameReplayerTest {
    @Test
    void replaysSanIntoUciAndKeys() {
        List<ReplayedMove> m = GameReplayer.replay("e4 e5 Nf3");
        assertEquals(3, m.size());
        assertEquals("e2e4", m.get(0).playedUci());
        assertEquals("w", m.get(0).mover());
        assertEquals(1, m.get(0).fullmove());
        assertEquals("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", m.get(0).beforeKey());
        assertTrue(m.get(0).afterKey().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq"));
        assertEquals("b", m.get(1).mover());
        assertEquals("e7e5", m.get(1).playedUci());
        assertEquals("g1f3", m.get(2).playedUci());
        assertEquals(2, m.get(2).fullmove());
        assertEquals("Nf3", m.get(2).playedSan());
        // after-key of ply n equals before-key of ply n+1
        assertEquals(m.get(0).afterKey(), m.get(1).beforeKey());
    }

    @Test
    void castlingIsUciKingMove() {
        List<ReplayedMove> m = GameReplayer.replay("e4 e5 Nf3 Nc6 Bc4 Bc5 O-O");
        assertEquals("e1g1", m.get(6).playedUci());
    }
}
