package com.blunderprint.chess;

public final class Fen {
    private Fen() {}

    /** First four FEN fields: placement, side, castling, en passant. */
    public static String key(String fen) {
        String[] p = fen.trim().split("\\s+");
        return p[0] + " " + p[1] + " " + p[2] + " " + p[3];
    }

    public static String forEngine(String key) {
        return key + " 0 1";
    }
}
