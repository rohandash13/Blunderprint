package com.blunderprint.analysis;

/** Win-chance-drop thresholds shared by candidate selection (analysis) and reporting. */
public final class Severity {
    public static final double INACCURACY = 0.05, MISTAKE = 0.10, BLUNDER = 0.15;

    /**
     * SQL predicate (needs table alias {@code a} = move_analysis, one {@code ?} for the minimum p_played) that
     * selects candidate mistakes: an inaccuracy that is plausible for the player, and either a mistake or a
     * quiet-best move.
     */
    public static final String CANDIDATE_SQL = "a.win_drop >= " + INACCURACY + " and a.p_played >= ? and "
        + "(a.win_drop >= " + MISTAKE + " or a.best_quiet)";

    private Severity() {}
}
