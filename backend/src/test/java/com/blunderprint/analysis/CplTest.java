package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class CplTest {
    @Test void playedBestMoveIsZero() { assertEquals(0, Cpl.compute(50, -50)); }
    @Test void losingMoveHasPositiveLoss() { assertEquals(150, Cpl.compute(50, 100)); }   // played = -100
    @Test void neverNegative() { assertEquals(0, Cpl.compute(50, -80)); }
    @Test void bothSidesMateScoresClampToTwoThousand() { assertEquals(2000, Cpl.compute(9999, 9999)); }
    @Test void missedMateToEqualIsOneThousand() { assertEquals(1000, Cpl.compute(9999, 0)); }
}
