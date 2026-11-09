"""Build player-split training arrays from a Lichess PGN dump (.pgn or .pgn.zst)."""
import hashlib
import io
import json
import os
import random
import re
import time

import chess
import chess.pgn
import numpy as np

from .encoding import N_FEATURES, encode_board, legal_mask, move_index, rating_bucket

DEFAULT_CAPS = {"train": 500_000, "val": 20_000, "test": 50_000}


def split_of(name: str) -> str:
    h = int(hashlib.md5(name.encode()).hexdigest(), 16) % 10
    return "test" if h == 0 else "val" if h == 1 else "train"


def game_split(white: str, black: str) -> str | None:
    s = split_of(white)
    return s if s == split_of(black) else None


def _open(path: str):
    if path.endswith(".zst"):
        import zstandard
        return io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(open(path, "rb")), encoding="utf-8")
    return open(path, encoding="utf-8")


def _base_seconds(tc: str) -> int:
    m = re.match(r"^(\d+)\+\d+$", tc or "")
    return int(m.group(1)) if m else 0


def build(pgn_path: str, out_dir: str, caps: dict | None = None, min_ply: int = 10,
          sample_prob: float = 0.33, seed: int = 0, min_base_seconds: int = 180) -> None:
    t0 = time.perf_counter()
    caps = caps or DEFAULT_CAPS
    if set(caps) - set(DEFAULT_CAPS):
        raise ValueError(f"unknown split(s) in caps: {sorted(set(caps) - set(DEFAULT_CAPS))}")
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(seed)
    X = {s: np.zeros((caps[s], N_FEATURES), dtype=np.uint8) for s in caps}
    y = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    rb = {s: np.zeros(caps[s], dtype=np.uint8) for s in caps}
    nl = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    ply_arr = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    L = {s: np.zeros((caps[s], 512), dtype=np.uint8) for s in ("val", "test") if s in caps}
    n = {s: 0 for s in caps}

    with _open(pgn_path) as fh:
        while any(n[s] < caps[s] for s in caps):
            game = chess.pgn.read_game(fh)
            if game is None:
                break
            h = game.headers
            white, black = h.get("White"), h.get("Black")
            if not white or not black or "?" in (white, black):
                continue                      # anonymous players would all share one split bucket
            split = game_split(white, black)
            if split is None or split not in caps or n[split] >= caps[split]:
                continue
            if not (h.get("WhiteElo", "").isdigit() and h.get("BlackElo", "").isdigit()):
                continue
            if _base_seconds(h.get("TimeControl", "")) < min_base_seconds:
                continue
            board = game.board()
            for ply, move in enumerate(game.mainline_moves()):
                if ply >= min_ply and n[split] < caps[split] and rng.random() < sample_prob:
                    rating = int(h["WhiteElo"] if board.turn == chess.WHITE else h["BlackElo"])
                    i = n[split]
                    X[split][i] = encode_board(board)
                    y[split][i] = move_index(move, board.turn == chess.BLACK)
                    rb[split][i] = rating_bucket(rating)
                    mask = legal_mask(board)
                    nl[split][i] = int(mask.sum())
                    ply_arr[split][i] = ply
                    if split in L:
                        L[split][i] = np.packbits(mask)
                    n[split] += 1
                board.push(move)

    for s in caps:
        k = n[s]
        np.save(os.path.join(out_dir, f"X_{s}.npy"), X[s][:k])
        np.save(os.path.join(out_dir, f"y_{s}.npy"), y[s][:k])
        np.save(os.path.join(out_dir, f"rb_{s}.npy"), rb[s][:k])
        np.save(os.path.join(out_dir, f"nlegal_{s}.npy"), nl[s][:k])
        np.save(os.path.join(out_dir, f"ply_{s}.npy"), ply_arr[s][:k])
        if s in L:
            np.save(os.path.join(out_dir, f"L_{s}.npy"), L[s][:k])
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump({"counts": n, "caps": caps, "source": os.path.basename(pgn_path), "min_ply": min_ply,
                   "sample_prob": sample_prob, "seed": seed, "min_base_seconds": min_base_seconds,
                   "seconds": round(time.perf_counter() - t0, 1)}, f, indent=2)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--train", type=int, default=DEFAULT_CAPS["train"])
    ap.add_argument("--val", type=int, default=DEFAULT_CAPS["val"])
    ap.add_argument("--test", type=int, default=DEFAULT_CAPS["test"])
    ap.add_argument("--sample-prob", type=float, default=0.33)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-base-seconds", type=int, default=180)
    args = ap.parse_args()
    build(args.pgn, args.out, caps={"train": args.train, "val": args.val, "test": args.test},
          sample_prob=args.sample_prob, seed=args.seed, min_base_seconds=args.min_base_seconds)
