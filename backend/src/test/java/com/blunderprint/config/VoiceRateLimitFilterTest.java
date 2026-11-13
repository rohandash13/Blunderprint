package com.blunderprint.config;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class VoiceRateLimitFilterTest {
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        void advance(Duration d) { now = now.plus(d); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    private MockHttpServletResponse hit(VoiceRateLimitFilter f, String uri, String remote, String xff) throws Exception {
        var req = new MockHttpServletRequest("GET", uri);
        req.setRemoteAddr(remote);
        if (xff != null) req.addHeader("X-Forwarded-For", xff);
        var res = new MockHttpServletResponse();
        f.doFilter(req, res, new MockFilterChain());
        return res;
    }

    @Test
    void perIpCapThenRecoversAfterAnHour() throws Exception {
        var clock = new MutableClock();
        var f = new VoiceRateLimitFilter(2, 100, clock);
        assertEquals(200, hit(f, "/voice/token", "1.1.1.1", null).getStatus());
        assertEquals(200, hit(f, "/voice/token", "1.1.1.1", null).getStatus());
        var blocked = hit(f, "/voice/token", "1.1.1.1", null);
        assertEquals(429, blocked.getStatus());
        assertEquals("{\"error\":\"Voice demo limit reached, try again later\"}", blocked.getContentAsString());
        assertEquals(200, hit(f, "/voice/token", "2.2.2.2", null).getStatus());
        clock.advance(Duration.ofMinutes(61));
        assertEquals(200, hit(f, "/voice/token", "1.1.1.1", null).getStatus());
    }

    @Test
    void usesLastForwardedForHopSoSpoofedPrefixDoesNotHelp() throws Exception {
        var f = new VoiceRateLimitFilter(1, 100, new MutableClock());
        assertEquals(200, hit(f, "/voice/token", "10.0.0.1", "1.2.3.4, 9.9.9.9").getStatus());
        assertEquals(429, hit(f, "/voice/token", "10.0.0.2", "5.6.7.8, 9.9.9.9").getStatus());
        assertEquals(200, hit(f, "/voice/token", "10.0.0.1", "8.8.8.8").getStatus());
        assertEquals(200, hit(f, "/voice/token", "7.7.7.7", null).getStatus()); // remote-addr fallback
        assertEquals(429, hit(f, "/voice/token", "7.7.7.7", null).getStatus());
    }

    @Test
    void globalDailyCapThenRecovers() throws Exception {
        var clock = new MutableClock();
        var f = new VoiceRateLimitFilter(100, 3, clock);
        for (int i = 0; i < 3; i++) assertEquals(200, hit(f, "/voice/token", "5.5.5." + i, null).getStatus());
        assertEquals(429, hit(f, "/voice/token", "5.5.5.9", null).getStatus());
        clock.advance(Duration.ofHours(25));
        assertEquals(200, hit(f, "/voice/token", "5.5.5.9", null).getStatus());
    }

    @Test
    void otherPathsAreNotLimited() throws Exception {
        var f = new VoiceRateLimitFilter(1, 1, new MutableClock());
        for (int i = 0; i < 5; i++) assertEquals(200, hit(f, "/health", "1.1.1.1", null).getStatus());
    }
}
