import chess
import numpy as np
import torch
from fastapi.testclient import TestClient

from blunderprint_ml.inference import p_played, legal_distribution
from blunderprint_ml.models import MLP


def _model():
    torch.manual_seed(0)
    return MLP(hidden=32).eval()


def test_distribution_sums_to_one_over_legal_moves():
    dist = legal_distribution(_model(), chess.STARTING_FEN, 1500)
    assert abs(sum(dist.values()) - 1.0) < 1e-5
    assert len(dist) == 20


def test_p_played_in_unit_interval_and_matches_distribution():
    m = _model()
    p = p_played(m, chess.STARTING_FEN, 1500, "e2e4")
    assert 0.0 < p < 1.0
    assert abs(p - legal_distribution(m, chess.STARTING_FEN, 1500)[chess.Move.from_uci("e2e4")]) < 1e-9


def test_service_analyze_roundtrip(tmp_path, monkeypatch):
    ck = tmp_path / "m.pt"
    torch.save({"model": "mlp", "state_dict": _model().state_dict(), "config": {"hidden": 32}}, ck)
    monkeypatch.setenv("MODEL_CKPT", str(ck))
    from blunderprint_ml import service
    with TestClient(service.create_app()) as client:
        assert client.get("/health").json() == {"ok": True}
        body = {"moves": [{"id": 5, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e4",
                           "best_uci": "d2d4", "cpl": 150, "clock_cs": None}]}
        out = client.post("/analyze", json=body).json()
        assert out[0]["id"] == 5
        assert 0.0 < out[0]["p_played"] < 1.0
        assert "opening_error" in out[0]["tags"]


def test_service_accepts_null_cpl_and_best(tmp_path, monkeypatch):
    # The Java side may send cpl = null and best_uci = null; the move must still be scored, with no tags.
    ck = tmp_path / "m.pt"
    torch.save({"model": "mlp", "state_dict": _model().state_dict(), "config": {"hidden": 32}}, ck)
    monkeypatch.setenv("MODEL_CKPT", str(ck))
    from blunderprint_ml import service
    with TestClient(service.create_app()) as client:
        body = {"moves": [{"id": 9, "fen": chess.STARTING_FEN, "rating": None, "played_uci": "e2e4",
                           "best_uci": None, "cpl": None, "clock_cs": None}]}
        out = client.post("/analyze", json=body).json()
        assert out[0]["id"] == 9
        assert 0.0 < out[0]["p_played"] < 1.0
        assert out[0]["tags"] == []
