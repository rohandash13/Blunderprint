import chess
import numpy as np

from blunderprint_ml.encoding import (
    N_FEATURES, N_MOVES, encode_board, legal_mask, move_index, rating_bucket,
)


def test_shapes_and_start_position_piece_count():
    x = encode_board(chess.Board())
    assert x.shape == (N_FEATURES,) and x.dtype == np.uint8
    assert x[:768].sum() == 32
    assert x[768:].tolist() == [1, 1, 1, 1]


def test_black_to_move_is_mirrored_so_mover_is_always_white():
    b = chess.Board()
    b.push_san("e4")                    # black to move
    x = encode_board(b)
    # Mover's pawns (black, mirrored to "white") occupy rank 2 => squares 8..15 in plane 0.
    assert x[0 * 64 + 8: 0 * 64 + 16].sum() == 8


def test_move_index_matches_for_mirrored_equivalent_moves():
    assert move_index(chess.Move.from_uci("e2e4"), False) == 12 * 64 + 28
    assert move_index(chess.Move.from_uci("e7e5"), True) == 12 * 64 + 28


def test_legal_mask_counts_start_moves():
    assert legal_mask(chess.Board()).sum() == 20
    assert legal_mask(chess.Board()).shape == (N_MOVES,)


def test_promotions_collapse_to_one_index():
    b = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
    mask = legal_mask(b)
    assert mask[move_index(chess.Move.from_uci("a7a8q"), False)]
    assert move_index(chess.Move.from_uci("a7a8q"), False) == move_index(chess.Move.from_uci("a7a8n"), False)


def test_rating_bucket():
    assert rating_bucket(500) == 0
    assert rating_bucket(1500) == 3
    assert rating_bucket(2900) == 9
    assert rating_bucket(None) == 3
