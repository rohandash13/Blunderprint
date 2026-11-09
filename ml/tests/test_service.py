import chess
import pytest
import torch
from fastapi.testclient import TestClient

from blunderprint_ml.encoding import move_index
from blunderprint_ml.inference import legal_distribution, p_played, p_played_batch
from blunderprint_ml.models import MLP


def _model():
    torch.manual_seed(0)
    return MLP(hidden=32).eval()


@pytest.fixture
def client(tmp_path, monkeypatch):
    ck = tmp_path / "m.pt"
    torch.save({"model": "mlp", "state_dict": _model().state_dict(), "config": {"hidden": 32}}, ck)
    monkeypatch.setenv("MODEL_CKPT", str(ck))
    from blunderprint_ml import service
    with TestClient(service.create_app()) as c:
        yield c


def _after_e4():
    b = chess.Board()
    b.push_san("e4")
    return b


def test_distribution_sums_to_one_over_legal_moves():
    dist = legal_distribution(_model(), chess.STARTING_FEN, 1500)
    assert abs(sum(dist.values()) - 1.0) < 1e-5
    assert len(dist) == 20


def test_p_played_in_unit_interval_and_matches_distribution():
    m = _model()
    p = p_played(m, chess.STARTING_FEN, 1500, "e2e4")
    assert 0.0 < p < 1.0
    assert abs(p - legal_distribution(m, chess.STARTING_FEN, 1500)[chess.Move.from_uci("e2e4")]) < 1e-9


def test_black_to_move_batch_matches_distribution():
    m = _model()
    board = _after_e4()
    assert board.turn == chess.BLACK
    dist = legal_distribution(m, board.fen(), 1500)
    move = chess.Move.from_uci("e7e5")
    assert abs(p_played_batch(m, [board], [move], [1500])[0] - dist[move]) < 1e-9
    # Promotions share an index, so count distinct indices; every one carries probability mass.
    indices = {move_index(mv, True) for mv in board.legal_moves}
    nonzero_entries = {move_index(mv, True) for mv, p in dist.items() if p > 0}
    assert len(nonzero_entries) == len(indices)
    assert abs(sum(dist.values()) - 1.0) < 1e-5


def test_black_perspective_matches_color_mirrored_position():
    # The model must see the same thing for a position and its color-mirrored twin.
    m = _model()
    black_board = _after_e4()
    white_board = black_board.mirror()
    assert white_board.turn == chess.WHITE
    for uci in ["e7e5", "g8f6", "b8c6"]:
        mv = chess.Move.from_uci(uci)
        mirrored = chess.Move(chess.square_mirror(mv.from_square), chess.square_mirror(mv.to_square))
        assert mirrored in white_board.legal_moves
        pb = p_played_batch(m, [black_board], [mv], [1500])[0]
        pw = p_played_batch(m, [white_board], [mirrored], [1500])[0]
        assert abs(pb - pw) < 1e-6


def test_batched_matches_unbatched():
    m = _model()
    fens_moves = [
        (chess.STARTING_FEN, "e2e4", 1500),
        (_after_e4().fen(), "e7e5", 1100),
        (_after_e4().fen(), "c7c5", None),
        ("r3k2r/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQkq - 0 1", "e1g1", 2000),
    ]
    boards = [chess.Board(f) for f, _, _ in fens_moves]
    moves = [chess.Move.from_uci(u) for _, u, _ in fens_moves]
    ratings = [r for _, _, r in fens_moves]
    batched = p_played_batch(m, boards, moves, ratings)
    for (fen, uci, r), pb in zip(fens_moves, batched):
        assert abs(pb - p_played(m, fen, r, uci)) < 1e-6


def test_service_analyze_roundtrip(client):
    assert client.get("/health").json() == {"ok": True}
    body = {"moves": [{"id": 5, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e4",
                       "best_uci": "d2d4", "cpl": 150, "clock_cs": None}]}
    out = client.post("/analyze", json=body).json()
    assert out[0]["id"] == 5
    assert 0.0 < out[0]["p_played"] < 1.0
    assert "opening_error" in out[0]["tags"]


def test_service_accepts_null_cpl_and_best(client):
    # The Java side may send cpl = null and best_uci = null; the move must still be scored, with no tags.
    body = {"moves": [{"id": 9, "fen": chess.STARTING_FEN, "rating": None, "played_uci": "e2e4",
                       "best_uci": None, "cpl": None, "clock_cs": None}]}
    out = client.post("/analyze", json=body).json()
    assert out[0]["id"] == 9
    assert 0.0 < out[0]["p_played"] < 1.0
    assert out[0]["tags"] == []


def test_service_scores_many_moves_in_order(client):
    moves = [{"id": i, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e4",
              "best_uci": None, "cpl": None, "clock_cs": None} for i in range(256)]
    out = client.post("/analyze", json={"moves": moves}).json()
    assert [o["id"] for o in out] == list(range(256))


def test_malformed_fen_returns_422_naming_id(client):
    body = {"moves": [{"id": 42, "fen": "not a fen", "rating": 1500, "played_uci": "e2e4",
                       "best_uci": None, "cpl": None, "clock_cs": None}]}
    r = client.post("/analyze", json=body)
    assert r.status_code == 422
    assert r.json()["detail"]["id"] == 42
    assert "FEN" in r.json()["detail"]["reason"]


def test_illegal_played_uci_returns_422_naming_id(client):
    body = {"moves": [{"id": 7, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e5",
                       "best_uci": None, "cpl": None, "clock_cs": None}]}
    r = client.post("/analyze", json=body)
    assert r.status_code == 422
    assert r.json()["detail"]["id"] == 7
    assert "illegal" in r.json()["detail"]["reason"]


def test_illegal_best_uci_returns_422_naming_id(client):
    body = {"moves": [{"id": 11, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "a2a3",
                       "best_uci": "e4e5", "cpl": 300, "clock_cs": None}]}
    r = client.post("/analyze", json=body)
    assert r.status_code == 422
    assert r.json()["detail"]["id"] == 11
    assert "illegal best_uci" in r.json()["detail"]["reason"]


def test_unparseable_best_uci_returns_422_naming_id(client):
    body = {"moves": [{"id": 8, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e4",
                       "best_uci": "zz", "cpl": 10, "clock_cs": None}]}
    r = client.post("/analyze", json=body)
    assert r.status_code == 422
    assert r.json()["detail"]["id"] == 8
