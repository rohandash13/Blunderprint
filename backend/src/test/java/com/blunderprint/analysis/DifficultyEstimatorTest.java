package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class DifficultyEstimatorTest {
    private static int e(int depth, boolean free, boolean quiet, boolean only) {
        return DifficultyEstimator.estimate(depth, free, quiet, only);
    }

    @Test
    void baseByDepth() {
        assertEquals(900, e(0, false, false, false));
        assertEquals(900, e(1, false, false, false));
        assertEquals(1200, e(2, false, false, false));
        assertEquals(1500, e(3, false, false, false));
        assertEquals(1500, e(4, false, false, false));
        assertEquals(1800, e(5, false, false, false));
        assertEquals(1800, e(6, false, false, false));
        assertEquals(2100, e(7, false, false, false));
        assertEquals(2100, e(8, false, false, false));
        assertEquals(2400, e(9, false, false, false));
        assertEquals(2400, e(10, false, false, false));
        assertEquals(2700, e(11, false, false, false));
        assertEquals(2700, e(14, false, false, false));
    }

    @Test
    void freeMaterialCapsAt1200() {
        assertEquals(1200, e(9, true, false, false));
        assertEquals(900, e(1, true, false, false));
    }

    @Test
    void quietAdjustments() {
        assertEquals(2000, e(5, false, true, true));
        assertEquals(2000, e(7, false, true, false));
        assertEquals(1800, e(5, false, false, true));
    }

    @Test
    void clamps() {
        assertEquals(2900, e(11, false, true, true));
        assertEquals(800, e(1, false, true, false));
        assertEquals(1100, e(2, true, true, false));
    }
}
