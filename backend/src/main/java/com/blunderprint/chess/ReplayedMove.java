package com.blunderprint.chess;

public record ReplayedMove(int ply, int fullmove, String mover, String beforeFen, String beforeKey,
                           String afterKey, String playedUci, String playedSan) {}
