package com.blunderprint.analysis;

public final class Cpl {
    private Cpl() {}

    private static int clamp(int v) { return Math.max(-1000, Math.min(1000, v)); }

    /**
     * @param bestScoreBefore  eval of the position before the move, mover's perspective
     * @param scoreAfterOpponentView  eval of the position after the move, opponent's perspective
     */
    public static int compute(int bestScoreBefore, int scoreAfterOpponentView) {
        return Math.max(0, clamp(bestScoreBefore) - clamp(-scoreAfterOpponentView));
    }
}
