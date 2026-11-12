package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class DifficultyTest {
    private static Difficulty nine() {
        List<Double> v = new java.util.ArrayList<>();
        for (int i = 1; i <= 9; i++) v.add(i / 100.0);
        return Difficulty.relative(v);
    }

    @Test
    void emptyIsUnrated() {
        Difficulty d = Difficulty.relative(List.of());
        assertTrue(d.empty());
        assertEquals("unrated", d.level(0.5));
        assertNull(d.harderThanPercent(0.5));
    }

    @Test
    void tertileCutoffs() {
        Difficulty d = nine();
        assertEquals(0.04, d.deepMax(), 1e-12);
        assertEquals(0.07, d.slipMin(), 1e-12);
        assertEquals("deep", d.level(0.03));
        assertEquals("tricky", d.level(0.04));
        assertEquals("tricky", d.level(0.06));
        assertEquals("slip", d.level(0.07));
        assertEquals("unrated", d.level(null));
    }

    @Test
    void harderThanPercent() {
        Difficulty d = nine();
        assertEquals(89, d.harderThanPercent(0.01));
        assertEquals(0, d.harderThanPercent(0.09));
        assertNull(d.harderThanPercent(null));
    }

    @Test
    void tinyRunsAreCoarse() {
        Difficulty d = Difficulty.relative(java.util.Arrays.asList(0.2, 0.4, null));
        assertEquals("tricky", d.level(0.2));
        assertEquals("tricky", d.level(0.4));
        assertEquals("tricky", d.level(0.1));
        assertEquals("tricky", Difficulty.relative(List.of(0.3)).level(0.3));
        assertEquals("unrated", d.level(null));
    }

    @Test
    void parsesLevelsIgnoringLocale() {
        java.util.Locale old = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(java.util.Locale.forLanguageTag("tr"));
            assertEquals(List.of("tricky"), Difficulty.parse("TRICKY"));
        } finally {
            java.util.Locale.setDefault(old);
        }
    }

    @Test
    void parsesLevels() {
        assertEquals(List.of("tricky", "deep"), Difficulty.parse(null));
        assertEquals(List.of("slip", "deep"), Difficulty.parse(" slip , deep "));
        assertThrows(IllegalArgumentException.class, () -> Difficulty.parse("hard"));
        assertThrows(IllegalArgumentException.class, () -> Difficulty.parse(" , "));
    }
}
