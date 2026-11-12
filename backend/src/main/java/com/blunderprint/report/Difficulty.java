package com.blunderprint.report;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Maps p_best (chance a player at this rating finds the engine move) to a challenge level. */
@Component
public class Difficulty {
    public static final List<String> ALL = List.of("slip", "tricky", "deep", "unrated");
    public static final List<String> DEFAULT = List.of("tricky", "deep");

    private final double slipMin;
    private final double deepMax;

    public Difficulty(@Value("${report.levels.slip-min}") double slipMin, @Value("${report.levels.deep-max}") double deepMax) {
        this.slipMin = slipMin;
        this.deepMax = deepMax;
    }

    public String level(Double pBest) {
        if (pBest == null) return "unrated";
        if (pBest >= slipMin) return "slip";
        if (pBest < deepMax) return "deep";
        return "tricky";
    }

    /** SQL expression for the level of column {@code col}; takes two parameters: slipMin, deepMax. */
    static String sqlLevel(String col) {
        return "(case when " + col + " is null then 'unrated' when " + col + " >= ? then 'slip' when "
            + col + " < ? then 'deep' else 'tricky' end)";
    }

    double slipMin() { return slipMin; }
    double deepMax() { return deepMax; }

    /** Parses "a,b"; null means DEFAULT. Throws IllegalArgumentException on unknown or empty input. */
    public static List<String> parse(String csv) {
        if (csv == null) return DEFAULT;
        List<String> out = new ArrayList<>();
        for (String raw : csv.split(",")) {
            String s = raw.trim().toLowerCase();
            if (s.isEmpty()) continue;
            if (!ALL.contains(s)) throw new IllegalArgumentException("unknown level: " + s);
            if (!out.contains(s)) out.add(s);
        }
        if (out.isEmpty()) throw new IllegalArgumentException("no levels given");
        return out;
    }
}
