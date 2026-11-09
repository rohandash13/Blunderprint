import chess

from blunderprint_ml.tags import tag_move


def mv(u):
    return chess.Move.from_uci(u)


def test_not_a_mistake_has_no_tags():
    assert tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 50, None) == []


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
    b = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 13")
    assert tag_move(b, mv("a2a3"), mv("f1b5"), 120, None) == ["other"]
