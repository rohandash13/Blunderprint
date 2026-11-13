import chess

from blunderprint_ml.tags import TAG_MIN_CPL, is_quiet, tag_move, wins_free_material


def mv(u):
    return chess.Move.from_uci(u)


def test_not_a_mistake_has_no_tags():
    assert TAG_MIN_CPL == 30
    assert tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 20, None) == []
    assert tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 29, None) == []


def test_hanging_piece():
    b = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    tags = tag_move(b, mv("d1g4"), mv("e4d5"), 400, None)      # queen walks into Bc8xg4
    assert "hanging_piece" in tags


def test_safe_capture_is_not_hanging():
    b = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    assert "hanging_piece" not in tag_move(b, mv("e4d5"), mv("e4e5"), 120, None)


def test_missed_tactic_when_best_is_check_and_played_is_quiet():
    b = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30")
    tags = tag_move(b, mv("g2g3"), mv("a1a8"), 1000, None)
    assert "missed_tactic" in tags


def test_opening_error():
    assert "opening_error" in tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 150, None)


def test_endgame_technique():
    b = chess.Board("8/8/4k3/8/8/4K3/4P3/8 w - - 0 60")
    assert "endgame_technique" in tag_move(b, mv("e3d3"), mv("e3f3"), 150, None)


def test_time_trouble():
    b = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    assert "time_trouble" in tag_move(b, mv("a2a3"), mv("f1b5"), 120, 1000)


def test_falls_back_to_other():
    b = chess.Board("r1bqkbnr/ppp2ppp/2n5/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 13")
    assert b.is_capture(mv("e4d5"))
    assert tag_move(b, mv("a2a3"), mv("e4d5"), 120, None) == ["other"]


_MIDDLE = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 13"


def test_is_quiet():
    assert is_quiet(chess.Board(), mv("e2e4"))
    cap = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    assert cap.is_capture(mv("e4d5")) and not is_quiet(cap, mv("e4d5"))
    chk = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30")
    assert chk.gives_check(mv("a1a8")) and not is_quiet(chk, mv("a1a8"))
    promo = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
    assert mv("a7a8q") in promo.legal_moves and not is_quiet(promo, mv("a7a8q"))


def test_wins_free_material_undefended_knight():
    b = chess.Board("4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1")
    assert mv("d1d5") in b.legal_moves
    assert wins_free_material(b, mv("d1d5"))


def test_equal_defended_trade_is_not_free():
    b = chess.Board("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1")
    assert b.is_capture(mv("d1d8"))
    assert not wins_free_material(b, mv("d1d8"))


def test_knight_takes_defended_pawn_is_not_free():
    b = chess.Board("4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1")
    assert b.is_capture(mv("c3d5"))
    assert not wins_free_material(b, mv("c3d5"))      # d5 is guarded by the c6 pawn


def test_pawn_takes_defended_rook_is_free():
    b = chess.Board("4k3/8/2p5/3r4/4P3/8/8/4K3 w - - 0 1")
    assert b.is_capture(mv("e4d5"))
    assert wins_free_material(b, mv("e4d5"))          # 5 - 1 >= 2 even though c6 recaptures


def test_en_passant_counts_as_pawn_capture():
    b = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")
    assert b.is_en_passant(mv("e5d6"))
    assert wins_free_material(b, mv("e5d6"))          # d6 undefended after the capture


def test_mate_in_one_is_free_material():
    b = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30")
    assert wins_free_material(b, mv("a1a8"))


def test_quiet_move_is_not_free_material():
    assert not wins_free_material(chess.Board(), mv("e2e4"))


def test_positional_tag_for_quiet_best():
    b = chess.Board(_MIDDLE)
    assert is_quiet(b, mv("f1b5"))
    assert tag_move(b, mv("a2a3"), mv("f1b5"), 60, None) == ["positional"]


def test_no_positional_when_best_is_forcing():
    b = chess.Board("r1bqkbnr/ppp2ppp/2n5/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 13")
    assert "positional" not in tag_move(b, mv("a2a3"), mv("e4d5"), 60, None)


def test_no_positional_when_hanging_piece_tagged():
    b = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    tags = tag_move(b, mv("d1g4"), mv("g1f3"), 400, None)
    assert "hanging_piece" in tags and "positional" not in tags


def test_no_tags_for_cpl_20_even_with_quiet_best():
    assert tag_move(chess.Board(_MIDDLE), mv("a2a3"), mv("f1b5"), 20, None) == []


def test_king_protected_by_pawn_cannot_recapture():
    b = chess.Board("8/8/4k3/3n4/4P3/8/8/3RK3 w - - 0 1")
    assert b.is_capture(mv("d1d5"))
    assert wins_free_material(b, mv("d1d5"))          # Kxd5 is illegal: e4 guards d5


def test_pinned_defender_cannot_recapture():
    b = chess.Board("2k5/8/2b5/3n4/8/8/8/2RQK3 w - - 0 1")
    assert b.is_capture(mv("d1d5"))
    assert wins_free_material(b, mv("d1d5"))          # Bc6 is pinned to Kc8 by Rc1, so Bxd5 is illegal


def test_king_takes_undefended_piece():
    b = chess.Board("8/8/8/3n4/3K4/8/8/7k w - - 0 1")
    assert b.is_capture(mv("d4d5"))
    assert wins_free_material(b, mv("d4d5"))


def test_promotion_capture_of_defended_rook():
    b = chess.Board("1rk5/P7/8/8/8/8/8/4K3 w - - 0 1")
    assert mv("a7b8q") in b.legal_moves and b.is_capture(mv("a7b8q"))
    assert wins_free_material(b, mv("a7b8q"))         # 5 - 1 >= 2
