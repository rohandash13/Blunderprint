package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

class FindDepthTest {
    private static TreeMap<Integer, String> moves(Object... kv) {
        var m = new TreeMap<Integer, String>();
        for (int i = 0; i < kv.length; i += 2) m.put((Integer) kv[i], (String) kv[i + 1]);
        return m;
    }

    @Test
    void flipAtSixThenStableFromSeven() {
        var m = moves(1, "a", 2, "a", 3, "a", 4, "a", 5, "a", 6, "b", 7, "a", 8, "a", 9, "a");
        assertEquals(7, StockfishEngine.findDepth(m, 9, "a"));
    }

    @Test
    void flipAtLastDepthGivesFinalDepth() {
        var m = moves(1, "a", 2, "a", 3, "b");
        assertEquals(3, StockfishEngine.findDepth(m, 3, "a"));
    }

    @Test
    void depthGapIsSkipped() {
        var m = moves(1, "b", 2, "a", 5, "a", 6, "a");
        assertEquals(2, StockfishEngine.findDepth(m, 6, "a"));
    }

    @Test
    void finalPvDisagreeingWithBestGivesFinalDepth() {
        var m = moves(1, "a", 2, "a", 3, "c");
        assertEquals(3, StockfishEngine.findDepth(m, 3, "a"));
    }

    @Test
    void measuredAgainstTargetNotAgainstWhateverLedEarlier() {
        // "b" led until depth 2; the final best is "a" (the target): found at 3. Against "b" it never holds.
        var m = moves(1, "b", 2, "b", 3, "a", 4, "a");
        assertEquals(3, StockfishEngine.findDepth(m, 4, "a"));
        assertEquals(4, StockfishEngine.findDepth(m, 4, "b"));
    }

    @Test
    void stableFromDepthOne() {
        var m = moves(1, "a", 2, "a", 3, "a");
        assertEquals(1, StockfishEngine.findDepth(m, 3, "a"));
    }
}
