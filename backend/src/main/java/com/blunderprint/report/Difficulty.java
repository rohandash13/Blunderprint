package com.blunderprint.report;

import java.util.ArrayList;
import java.util.List;

/**
 * Challenge level of a candidate mistake relative to the mover's rating: slip (should be found at this level),
 * tricky, deep (a stretch), or unrated (no difficulty estimate yet).
 */
public final class Difficulty {
    public static final List<String> ALL = List.of("slip", "tricky", "deep", "unrated");
    public static final List<String> DEFAULT = List.of("tricky", "deep");
    public static final int DEFAULT_RATING = 1500;

    private final int slipBelow;
    private final int deepAbove;

    public Difficulty(int slipBelow, int deepAbove) {
        this.slipBelow = slipBelow;
        this.deepAbove = deepAbove;
    }

    /** slip: elo &lt;= R - slipBelow; deep: elo &gt; R + deepAbove; tricky otherwise; unrated when elo is null. */
    public String level(Integer difficultyElo, Integer rating) {
        if (difficultyElo == null) return "unrated";
        int r = rating == null ? DEFAULT_RATING : rating;
        if (difficultyElo <= r - slipBelow) return "slip";
        if (difficultyElo > r + deepAbove) return "deep";
        return "tricky";
    }

    /** SQL expression mirroring {@link #level}; the offsets are ints so inlining them is safe. */
    public String sqlLevel(String eloCol, String ratingCol) {
        String r = "coalesce(" + ratingCol + ", " + DEFAULT_RATING + ")";
        return "(case when " + eloCol + " is null then 'unrated' when " + eloCol + " <= " + r + " - " + slipBelow
            + " then 'slip' when " + eloCol + " > " + r + " + " + deepAbove + " then 'deep' else 'tricky' end)";
    }

    /** Parses "a,b"; null means DEFAULT. Throws IllegalArgumentException on unknown or empty input. */
    public static List<String> parse(String csv) {
        if (csv == null) return DEFAULT;
        List<String> out = new ArrayList<>();
        for (String raw : csv.split(",")) {
            String s = raw.trim().toLowerCase(java.util.Locale.ROOT);
            if (s.isEmpty()) continue;
            if (!ALL.contains(s)) throw new IllegalArgumentException("unknown level: " + s);
            if (!out.contains(s)) out.add(s);
        }
        if (out.isEmpty()) throw new IllegalArgumentException("no levels given");
        return out;
    }
}
