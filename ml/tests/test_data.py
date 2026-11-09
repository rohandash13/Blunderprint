import json
import random

import chess
import chess.pgn
import numpy as np

from blunderprint_ml.data import build, game_split, split_of


def _names_in(split: str, n: int) -> list[str]:
    out, i = [], 0
    while len(out) < n:
        name = f"player{i}"
        if split_of(name) == split:
            out.append(name)
        i += 1
    return out


def _write_games(path, white, black, n_games, seed=0):
    rng = random.Random(seed)
    with open(path, "w") as f:
        for _ in range(n_games):
            board = chess.Board()
            game = chess.pgn.Game()
            game.headers.update({"White": white, "Black": black, "WhiteElo": "1500", "BlackElo": "1480",
                                 "TimeControl": "300+0", "Result": "1/2-1/2"})
            node = game
            for _ in range(60):
                if board.is_game_over():
                    break
                m = rng.choice(list(board.legal_moves))
                board.push(m)
                node = node.add_variation(m)
            print(game, file=f, end="\n\n")


def test_split_is_deterministic_and_ten_percent_buckets():
    assert split_of("abc") == split_of("abc")
    names = [f"n{i}" for i in range(2000)]
    test_share = sum(split_of(n) == "test" for n in names) / len(names)
    assert 0.06 < test_share < 0.14


def test_game_split_requires_same_bucket():
    a, b = _names_in("train", 2)
    c = _names_in("test", 1)[0]
    assert game_split(a, b) == "train"
    assert game_split(a, c) is None


def test_build_writes_arrays_and_respects_split(tmp_path):
    tr = _names_in("train", 2)
    te = _names_in("test", 2)
    pgn = tmp_path / "g.pgn"
    _write_games(pgn, tr[0], tr[1], 6, seed=1)
    pgn2 = tmp_path / "g2.pgn"
    _write_games(pgn2, te[0], te[1], 6, seed=2)
    combined = tmp_path / "all.pgn"
    combined.write_text(pgn.read_text() + pgn2.read_text())

    out = tmp_path / "out"
    build(str(combined), str(out), caps={"train": 100, "val": 10, "test": 100}, sample_prob=1.0, min_ply=10)

    meta = json.loads((out / "meta.json").read_text())
    assert meta["counts"]["train"] > 0 and meta["counts"]["test"] > 0 and meta["counts"]["val"] == 0
    X = np.load(out / "X_train.npy")
    y = np.load(out / "y_train.npy")
    assert X.shape == (meta["counts"]["train"], 772)
    assert y.min() >= 0 and y.max() < 4096
    assert np.load(out / "L_test.npy").shape == (meta["counts"]["test"], 512)
    assert not (out / "L_train.npy").exists()
    # Every label must be a legal move in its position.
    legal = np.unpackbits(np.load(out / "L_test.npy"), axis=1).astype(bool)
    y_test = np.load(out / "y_test.npy")
    assert legal[np.arange(len(y_test)), y_test].all()


def test_build_drops_games_between_players_in_different_splits(tmp_path):
    tr = _names_in("train", 1)[0]
    te = _names_in("test", 1)[0]
    same = tmp_path / "same.pgn"
    _write_games(same, tr, _names_in("train", 2)[1], 4, seed=3)
    mixed = tmp_path / "mixed.pgn"
    _write_games(mixed, tr, te, 4, seed=4)
    both = tmp_path / "both.pgn"
    both.write_text(mixed.read_text() + same.read_text())
    caps = {"train": 1000, "val": 10, "test": 1000}

    build(str(same), str(tmp_path / "a"), caps=caps, sample_prob=1.0)
    build(str(both), str(tmp_path / "b"), caps=caps, sample_prob=1.0)

    a = json.loads((tmp_path / "a" / "meta.json").read_text())["counts"]
    b = json.loads((tmp_path / "b" / "meta.json").read_text())["counts"]
    assert a == b and b["test"] == 0
    assert np.array_equal(np.load(tmp_path / "a" / "X_train.npy"), np.load(tmp_path / "b" / "X_train.npy"))
