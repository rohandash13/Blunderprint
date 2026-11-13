package com.blunderprint.engine;

/** Scores are centipawns from the side to move (mate-encoded); secondCp is null with a single legal move. */
public record Trace(String bestUci, int bestCp, Integer secondCp, int findDepth) {}
