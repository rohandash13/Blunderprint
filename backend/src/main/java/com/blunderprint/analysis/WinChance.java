package com.blunderprint.analysis;

/** Lichess win-chance curve on a [0,1] scale. */
public final class WinChance {
    private static final double K = 0.00368208;

    private WinChance() {}

    public static double of(int cp) {
        return 1.0 / (1.0 + Math.exp(-K * cp));
    }

    /** Win chance lost by playing a move worth {@code playedCpForMover} instead of the best one. */
    public static double drop(int bestCpForMover, int playedCpForMover) {
        return of(bestCpForMover) - of(playedCpForMover);
    }
}
