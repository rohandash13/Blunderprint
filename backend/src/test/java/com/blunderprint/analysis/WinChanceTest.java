package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class WinChanceTest {
    @Test
    void zeroIsHalf() {
        assertEquals(0.5, WinChance.of(0), 1e-12);
    }

    @Test
    void symmetric() {
        assertEquals(1.0, WinChance.of(300) + WinChance.of(-300), 1e-12);
    }

    @Test
    void knownValue() {
        assertEquals(0.751, WinChance.of(300), 0.001);
    }

    @Test
    void mateScoresAreFiniteProbabilities() {
        for (int cp : new int[] {9999, -9999, 10000, -10000}) {
            double w = WinChance.of(cp);
            assertTrue(Double.isFinite(w) && w >= 0.0 && w <= 1.0, "of(" + cp + ")=" + w);
        }
        assertEquals(1.0, WinChance.of(9999), 1e-9);
        assertEquals(0.0, WinChance.of(-9999), 1e-9);
        assertTrue(Double.isFinite(WinChance.drop(9999, -9999)));
    }

    @Test
    void dropPositiveForWorseMove() {
        assertTrue(WinChance.drop(100, -100) > 0);
        assertEquals(0.0, WinChance.drop(50, 50), 1e-12);
        assertEquals(WinChance.of(100) - WinChance.of(-100), WinChance.drop(100, -100), 1e-12);
    }
}
