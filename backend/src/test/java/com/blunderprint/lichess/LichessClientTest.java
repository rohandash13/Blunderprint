package com.blunderprint.lichess;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class LichessClientTest {
    private static final String LINE = """
        {"id":"abc12345","rated":true,"perf":"blitz","createdAt":1700000000000,"status":"mate","winner":"white",
         "players":{"white":{"user":{"name":"Alice"},"rating":1500},"black":{"user":{"name":"Bob"},"rating":1480}},
         "moves":"e4 e5 Nf3","clocks":[18000,18000,17900]}""".replace("\n", "");

    @Test
    void parsesGameLine() {
        LichessGame g = LichessClient.parseLine(LINE).orElseThrow();
        assertEquals("abc12345", g.id());
        assertEquals("Alice", g.white());
        assertEquals(1480, g.blackRating());
        assertEquals("1-0", g.result());
        assertEquals("blitz", g.perf());
        assertEquals("e4 e5 Nf3", g.sanMoves());
        assertEquals(java.util.List.of(18000, 18000, 17900), g.clocksCs());
    }

    @Test
    void drawHasHalfPointResult() {
        String draw = LINE.replace("\"winner\":\"white\",", "");
        assertEquals("1/2-1/2", LichessClient.parseLine(draw).orElseThrow().result());
    }

    @Test
    void skipsGamesWithoutNamedPlayersOrMoves() {
        assertTrue(LichessClient.parseLine(LINE.replace("\"user\":{\"name\":\"Bob\"},", "")).isEmpty());
        assertTrue(LichessClient.parseLine(LINE.replace("\"moves\":\"e4 e5 Nf3\"", "\"moves\":\"\"")).isEmpty());
    }
}
