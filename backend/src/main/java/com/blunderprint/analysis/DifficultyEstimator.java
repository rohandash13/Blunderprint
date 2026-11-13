package com.blunderprint.analysis;

/** Estimates the rating at which players usually find the engine's best move. */
public final class DifficultyEstimator {
    static final int MIN_ELO = 600;
    static final int MAX_ELO = 3000;
    static final int FREE_MATERIAL_CAP = 1200;
    static final int QUIET_ONLY_MOVE_BONUS = 200;
    static final int QUIET_MANY_PENALTY = 100;

    private DifficultyEstimator() {}

    static int base(int findDepth) {
        if (findDepth <= 1) return 900;
        if (findDepth == 2) return 1200;
        if (findDepth <= 4) return 1500;
        if (findDepth <= 6) return 1800;
        if (findDepth <= 8) return 2100;
        if (findDepth <= 10) return 2400;
        return 2700;
    }

    public static int estimate(int findDepth, boolean freeMaterial, boolean quiet, boolean onlyMove) {
        int elo = base(findDepth);
        if (freeMaterial) elo = Math.min(elo, FREE_MATERIAL_CAP);
        if (quiet && onlyMove) elo += QUIET_ONLY_MOVE_BONUS;
        if (quiet && !onlyMove) elo -= QUIET_MANY_PENALTY;
        return Math.max(MIN_ELO, Math.min(MAX_ELO, elo));
    }
}
