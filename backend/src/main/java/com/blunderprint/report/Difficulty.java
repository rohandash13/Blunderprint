package com.blunderprint.report;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Objects;

/**
 * Challenge level of a mistake, relative to the player's own candidate mistakes in one analysis run:
 * cutoffs sit at the tertiles of their p_best values (lowest p_best = hardest).
 */
public final class Difficulty {
    public static final List<String> ALL = List.of("slip", "tricky", "deep", "unrated");
    public static final List<String> DEFAULT = List.of("tricky", "deep");

    private final double[] sorted;   // candidate p_best values, ascending
    private final double slipMin;
    private final double deepMax;

    private Difficulty(double[] sorted, double slipMin, double deepMax) {
        this.sorted = sorted;
        this.slipMin = slipMin;
        this.deepMax = deepMax;
    }

    /** Cutoffs at the tertiles of this run's candidate p_best values (nulls ignored). */
    public static Difficulty relative(Collection<Double> candidatePBest) {
        double[] c = candidatePBest.stream().filter(Objects::nonNull).mapToDouble(Double::doubleValue).sorted().toArray();
        int n = c.length;
        // With no candidates, level() reports "unrated" for everything, but the SQL cutoffs (+inf / -inf) would
        // classify a non-null p_best as tricky. That only affects non-candidates, which the report never counts.
        if (n == 0) return new Difficulty(c, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY);
        // Too few to split into thirds: every rated candidate is "tricky".
        if (n < 3) return new Difficulty(c, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY);
        return new Difficulty(c, c[(2 * n) / 3], c[n / 3]);
    }

    public String level(Double pBest) {
        if (pBest == null || empty()) return "unrated";
        if (pBest >= slipMin) return "slip";
        if (pBest < deepMax) return "deep";
        return "tricky";
    }

    /** Share of the player's candidate mistakes that are easier (higher p_best) than this one, in percent. */
    public Integer harderThanPercent(Double pBest) {
        if (pBest == null || empty()) return null;
        int lo = 0, hi = sorted.length;
        while (lo < hi) {                      // first index with value > pBest
            int mid = (lo + hi) >>> 1;
            if (sorted[mid] > pBest) hi = mid; else lo = mid + 1;
        }
        return (int) Math.round(100.0 * (sorted.length - lo) / sorted.length);
    }

    /** SQL expression for the level of column {@code col}; takes two parameters: slipMin, deepMax. */
    static String sqlLevel(String col) {
        return "(case when " + col + " is null then 'unrated' when " + col + " >= ? then 'slip' when "
            + col + " < ? then 'deep' else 'tricky' end)";
    }

    double slipMin() { return slipMin; }
    double deepMax() { return deepMax; }
    boolean empty() { return sorted.length == 0; }

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
