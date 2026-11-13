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
    void parsesUserPerfs() {
        var perfs = LichessClient.parseUser("""
            {"id":"alice","perfs":{"blitz":{"games":420,"rating":1650,"rd":50,"prog":12},
             "rapid":{"games":10,"rating":1500,"rd":90},"puzzle":{"games":5,"rating":1900,"rd":60,"prog":1},
             "bullet":{"games":0,"rating":1500,"rd":500,"prog":0}}}""");
        assertEquals(new LichessClient.Perf(1650, 420, 12), perfs.get("blitz"));
        assertEquals(new LichessClient.Perf(1500, 10, 0), perfs.get("rapid"));
        assertFalse(perfs.containsKey("puzzle"));
        assertFalse(perfs.containsKey("bullet"));
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

    private static com.sun.net.httpserver.HttpServer server(java.util.concurrent.atomic.AtomicInteger hits, int status,
                                                            String body) throws java.io.IOException {
        var srv = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            hits.incrementAndGet();
            byte[] b = body.getBytes();
            ex.sendResponseHeaders(status, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        srv.start();
        return srv;
    }

    @Test
    void non200IsNullAndNegativelyCachedForAMinute() throws Exception {
        var hits = new java.util.concurrent.atomic.AtomicInteger();
        var srv = server(hits, 500, "{}");
        try {
            long[] t = {1_000_000};
            var c = new LichessClient("http://127.0.0.1:" + srv.getAddress().getPort(), "", () -> t[0]);
            assertNull(c.fetchUser("Alice"));
            assertNull(c.fetchUser("alice"));
            assertEquals(1, hits.get());
            t[0] += 61_000;
            assertNull(c.fetchUser("Alice"));
            assertEquals(2, hits.get());
        } finally {
            srv.stop(0);
        }
    }

    @Test
    void successIsCachedTenMinutesThenRefetched() throws Exception {
        var hits = new java.util.concurrent.atomic.AtomicInteger();
        var srv = server(hits, 200, "{\"perfs\":{\"blitz\":{\"games\":5,\"rating\":1600,\"prog\":3}}}");
        try {
            long[] t = {1_000_000};
            var c = new LichessClient("http://127.0.0.1:" + srv.getAddress().getPort(), "", () -> t[0]);
            assertEquals(1600, c.fetchUser("Alice").get("blitz").rating());
            t[0] += 599_000;
            c.fetchUser("Alice");
            assertEquals(1, hits.get());
            t[0] += 2_000;
            c.fetchUser("Alice");
            assertEquals(2, hits.get());
        } finally {
            srv.stop(0);
        }
    }

    @Test
    void unreachableHostIsNull() {
        var c = new LichessClient("http://127.0.0.1:1", "", System::currentTimeMillis);
        assertNull(c.fetchUser("Alice"));
    }
}
