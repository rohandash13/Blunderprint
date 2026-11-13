package com.blunderprint.engine;

/**
 * MultiPV-2 trace of one position, described relative to the move being drilled (the stored best move).
 * Scores are centipawns from the side to move (mate-encoded); secondCp/secondUci are null with a single legal move.
 * findDepth is measured against the target move; targetIsBest says the final multipv-1 line starts with it.
 */
public record Trace(String bestUci, int bestCp, Integer secondCp, String secondUci, int findDepth,
                    boolean targetIsBest) {}
