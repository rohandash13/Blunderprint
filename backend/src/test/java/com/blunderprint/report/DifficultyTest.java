package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class DifficultyTest {
    private final Difficulty d = new Difficulty(0.50, 0.15);

    @Test
    void mapsBoundaries() {
        assertEquals("unrated", d.level(null));
        assertEquals("slip", d.level(0.50));
        assertEquals("tricky", d.level(0.4999));
        assertEquals("tricky", d.level(0.15));
        assertEquals("deep", d.level(0.1499));
    }

    @Test
    void parsesLevels() {
        assertEquals(List.of("tricky", "deep"), Difficulty.parse(null));
        assertEquals(List.of("slip", "deep"), Difficulty.parse(" slip , deep "));
        assertThrows(IllegalArgumentException.class, () -> Difficulty.parse("hard"));
        assertThrows(IllegalArgumentException.class, () -> Difficulty.parse(" , "));
    }
}
