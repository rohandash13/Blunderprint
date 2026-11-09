package com.blunderprint.chess;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Side;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveList;
import java.util.ArrayList;
import java.util.List;

public final class GameReplayer {
    private GameReplayer() {}

    public static List<ReplayedMove> replay(String sanMoves) {
        String[] sans = sanMoves.trim().split("\\s+");
        MoveList list = new MoveList();
        list.loadFromSan(sanMoves);
        if (list.size() != sans.length) {
            throw new IllegalArgumentException("SAN parse mismatch: " + list.size() + " vs " + sans.length);
        }
        Board board = new Board();
        List<ReplayedMove> out = new ArrayList<>();
        int ply = 0;
        for (Move m : list) {
            String mover = board.getSideToMove() == Side.WHITE ? "w" : "b";
            String beforeFen = board.getFen();
            board.doMove(m);
            out.add(new ReplayedMove(ply, ply / 2 + 1, mover, beforeFen, Fen.key(beforeFen),
                Fen.key(board.getFen()), uci(m), sans[ply]));
            ply++;
        }
        return out;
    }

    private static String uci(Move m) {
        String s = m.getFrom().value().toLowerCase() + m.getTo().value().toLowerCase();
        if (m.getPromotion() != Piece.NONE) {
            s += switch (m.getPromotion().getPieceType()) {
                case QUEEN -> "q";
                case ROOK -> "r";
                case BISHOP -> "b";
                case KNIGHT -> "n";
                default -> "";
            };
        }
        return s;
    }
}
