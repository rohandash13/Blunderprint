package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class AnalysisGateTest {
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-12T10:00:00Z");
        void advance(Duration d) { now = now.plus(d); }
        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final MutableClock clock = new MutableClock();

    private AnalysisGate gate(int global, int perIp) {
        return new AnalysisGate(null, clock, global, perIp, 7, 20);
    }

    @Test
    void perIpCapRejectsFourthRunAndOtherIpsAreUnaffected() {
        var g = gate(40, 3);
        for (int i = 0; i < 3; i++) g.reserve("1.1.1.1");
        var e = assertThrows(AnalysisGate.CapExceededException.class, () -> g.reserve("1.1.1.1"));
        assertFalse(e.getMessage().isBlank());
        g.reserve("2.2.2.2");
    }

    @Test
    void globalCapRejectsAcrossIps() {
        var g = gate(2, 3);
        g.reserve("1.1.1.1");
        g.reserve("2.2.2.2");
        assertThrows(AnalysisGate.CapExceededException.class, () -> g.reserve("3.3.3.3"));
    }

    @Test
    void capsRollOffAfter24Hours() {
        var g = gate(40, 1);
        g.reserve("1.1.1.1");
        clock.advance(Duration.ofHours(23));
        assertThrows(AnalysisGate.CapExceededException.class, () -> g.reserve("1.1.1.1"));
        clock.advance(Duration.ofHours(2));
        g.reserve("1.1.1.1");
    }

    @Test
    void attemptsAreLimitedPerIpPerHourAndNeverReleased() {
        var g = gate(40, 3);
        for (int i = 0; i < 20; i++) g.tryAttempt("1.1.1.1");
        assertThrows(AnalysisGate.CapExceededException.class, () -> g.tryAttempt("1.1.1.1"));
        g.tryAttempt("2.2.2.2");
        clock.advance(Duration.ofMinutes(61));
        g.tryAttempt("1.1.1.1");
    }

    @Test
    void missingUsersAreRememberedForTenMinutesCaseInsensitively() {
        var g = gate(40, 3);
        assertFalse(g.isKnownMissing("Ghost"));
        g.markMissing("Ghost");
        clock.advance(Duration.ofMinutes(9));
        assertTrue(g.isKnownMissing("ghost"));
        clock.advance(Duration.ofMinutes(2));
        assertFalse(g.isKnownMissing("ghost"));
    }

    @Test
    void releaseGivesTheSlotBack() {
        var g = gate(1, 1);
        var token = g.reserve("1.1.1.1");
        g.release(token);
        g.reserve("1.1.1.1");
    }
}
