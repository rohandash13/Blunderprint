package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class DifficultyTest {
    private final Difficulty d = new Difficulty(300, 100);

    @Test
    void levelBoundariesRelativeToRating() {
        assertEquals("slip", d.level(1200, 1500));      // R-300 inclusive
        assertEquals("tricky", d.level(1201, 1500));
        assertEquals("tricky", d.level(1600, 1500));    // R+100 exclusive for deep
        assertEquals("deep", d.level(1601, 1500));
        assertEquals("unrated", d.level(null, 1500));
    }

    @Test
    void missingRatingDefaultsTo1500() {
        assertEquals("slip", d.level(1200, null));
        assertEquals("deep", d.level(1601, null));
    }

    @Test
    void sameMoveIsSlipForStrongPlayerAndDeepForWeak() {
        assertEquals("slip", d.level(1200, 2450));
        assertEquals("deep", d.level(1800, 1200));
    }

    @Test
    void sqlMirrorsJava() {
        String sql = d.sqlLevel("a.difficulty_elo", "m.rating");
        assertTrue(sql.contains("coalesce(m.rating, 1500) - 300"));
        assertTrue(sql.contains("coalesce(m.rating, 1500) + 100"));
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
