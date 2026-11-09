"""Position and move encoding. Always from the mover's perspective: Black-to-move
positions are mirrored so the mover is 'white'."""
import chess
import numpy as np

N_FEATURES = 772
N_MOVES = 4096
N_BUCKETS = 10


def encode_board(board: chess.Board) -> np.ndarray:
    b = board.mirror() if board.turn == chess.BLACK else board
    x = np.zeros(N_FEATURES, dtype=np.uint8)
    for sq, piece in b.piece_map().items():
        plane = (piece.piece_type - 1) + (0 if piece.color == chess.WHITE else 6)
        x[plane * 64 + sq] = 1
    x[768] = b.has_kingside_castling_rights(chess.WHITE)
    x[769] = b.has_queenside_castling_rights(chess.WHITE)
    x[770] = b.has_kingside_castling_rights(chess.BLACK)
    x[771] = b.has_queenside_castling_rights(chess.BLACK)
    return x


def move_index(move: chess.Move, black_to_move: bool) -> int:
    f, t = move.from_square, move.to_square
    if black_to_move:
        f, t = chess.square_mirror(f), chess.square_mirror(t)
    return f * 64 + t


def legal_mask(board: chess.Board) -> np.ndarray:
    mask = np.zeros(N_MOVES, dtype=bool)
    black = board.turn == chess.BLACK
    for m in board.legal_moves:
        mask[move_index(m, black)] = True
    return mask


def rating_bucket(rating: int | None) -> int:
    r = 1500 if rating is None else rating
    return int(min(max((r - 800) // 200, 0), N_BUCKETS - 1))
