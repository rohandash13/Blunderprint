"""Build player-split training arrays from a Lichess PGN dump.

The source can be a local .pgn / .pgn.zst file or a month ("2026-10"), which is streamed from
database.lichess.org and decompressed on the fly, so the 30 GB dump is never written to disk. Reading
stops as soon as every split is full.

Boards are stored bit-packed (`Xb_<split>.npy`, shape (n, 97)); `load_X` unpacks them to the 772
features of `encoding.encode_board`. Parsing runs in worker processes, but games are committed in file
order and each game's position sampling is seeded by the game itself, so the output is identical for
any worker count.
"""
import collections
import hashlib
import io
import json
import multiprocessing as mp
import os
import random
import re
import time

import chess
import chess.pgn
import numpy as np

from .encoding import N_FEATURES, encode_board, legal_mask, move_index, rating_bucket

DEFAULT_CAPS = {"train": 500_000, "val": 20_000, "test": 50_000}
LICHESS_URL = "https://database.lichess.org/standard/lichess_db_standard_rated_{month}.pgn.zst"
N_PACKED = (N_FEATURES + 7) // 8
_TAG = re.compile(r'^\[(\w+) "(.*)"\]\s*$')


def split_of(name: str) -> str:
    h = int(hashlib.md5(name.encode()).hexdigest(), 16) % 10
    return "test" if h == 0 else "val" if h == 1 else "train"


def game_split(white: str, black: str) -> str | None:
    s = split_of(white)
    return s if s == split_of(black) else None


def source_of(pgn: str) -> str:
    """A month like '2026-10' becomes its database.lichess.org URL; anything else is a path or URL."""
    return LICHESS_URL.format(month=pgn) if re.fullmatch(r"\d{4}-\d{2}", pgn) else pgn


class _Source:
    """Text stream over a local or remote .pgn / .pgn.zst; remote files are streamed, never stored."""

    def __init__(self, src: str):
        self.raw, self.resp = None, None
        if src.startswith(("http://", "https://")):
            import requests
            self.resp = requests.get(src, stream=True, timeout=60)
            self.resp.raise_for_status()
            self.resp.raw.decode_content = True
            binary = self.resp.raw
        else:
            binary = self.raw = open(src, "rb")
        if src.endswith(".zst"):
            import zstandard
            binary = zstandard.ZstdDecompressor().stream_reader(binary, read_across_frames=True)
        self.text = io.TextIOWrapper(binary, encoding="utf-8", errors="replace")

    def __enter__(self):
        return self.text

    def __exit__(self, *exc):
        self.text.close()
        if self.resp is not None:
            self.resp.close()
        if self.raw is not None:
            self.raw.close()


def _games(fh):
    """Yield (headers, raw_game_text) per game, splitting on the [Event tag."""
    lines: list[str] = []
    for line in fh:
        if line.startswith("[Event ") and any(not l.startswith("[") and l.strip() for l in lines):
            yield _headers(lines), "".join(lines)
            lines = []
        lines.append(line)
    if lines:
        yield _headers(lines), "".join(lines)


def _headers(lines: list[str]) -> dict:
    out = {}
    for line in lines:
        if not line.startswith("["):
            break
        m = _TAG.match(line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def _base_seconds(tc: str) -> int:
    m = re.match(r"^(\d+)\+\d+$", tc or "")
    return int(m.group(1)) if m else 0


def _encode_game(job):
    """Worker: sample positions from one game. Returns arrays for that game (possibly empty)."""
    text, white_elo, black_elo, game_seed, with_mask, min_ply, sample_prob, boost, boost_min = job
    rng = random.Random(game_seed)
    game = chess.pgn.read_game(io.StringIO(text))
    xs, ys, rbs, plies, Ls, nls = [], [], [], [], [], []
    if game is not None:
        board = game.board()
        for ply, move in enumerate(game.mainline_moves()):
            rating = white_elo if board.turn == chess.WHITE else black_elo
            p = min(1.0, sample_prob * (boost if rating >= boost_min else 1.0))
            if ply >= min_ply and rng.random() < p:
                xs.append(np.packbits(encode_board(board)))
                ys.append(move_index(move, board.turn == chess.BLACK))
                rbs.append(rating_bucket(rating))
                plies.append(ply)
                if with_mask:
                    mask = legal_mask(board)
                    nls.append(int(mask.sum()))
                    Ls.append(np.packbits(mask))
            board.push(move)
    return xs, ys, rbs, plies, Ls, nls


def build(pgn_path: str, out_dir: str, caps: dict | None = None, min_ply: int = 10,
          sample_prob: float = 0.33, seed: int = 0, min_base_seconds: int = 180,
          high_elo_boost: float = 1.0, high_elo_min: int = 2200, workers: int = 0) -> None:
    t0 = time.perf_counter()
    caps = caps or DEFAULT_CAPS
    if set(caps) - set(DEFAULT_CAPS):
        raise ValueError(f"unknown split(s) in caps: {sorted(set(caps) - set(DEFAULT_CAPS))}")
    src = source_of(pgn_path)
    os.makedirs(out_dir, exist_ok=True)
    Xb = {s: np.zeros((caps[s], N_PACKED), dtype=np.uint8) for s in caps}
    y = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    rb = {s: np.zeros(caps[s], dtype=np.uint8) for s in caps}
    ply_arr = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    # Legal masks and legal-move counts are only needed for evaluation, so only val/test pay for them.
    eval_splits = [s for s in ("val", "test") if s in caps]
    L = {s: np.zeros((caps[s], 512), dtype=np.uint8) for s in eval_splits}
    nl = {s: np.zeros(caps[s], dtype=np.int16) for s in eval_splits}
    n = {s: 0 for s in caps}
    games_read = 0

    def wanted_split(h) -> str | None:
        white, black = h.get("White"), h.get("Black")
        if not white or not black or "?" in (white, black):
            return None                       # anonymous players would all share one split bucket
        split = game_split(white, black)
        if split is None or split not in caps or n[split] >= caps[split]:
            return None
        if not (h.get("WhiteElo", "").isdigit() and h.get("BlackElo", "").isdigit()):
            return None
        if _base_seconds(h.get("TimeControl", "")) < min_base_seconds:
            return None
        return split

    def commit(split, res):
        xs, ys, rbs, plies, Ls, nls = res
        k = min(len(ys), caps[split] - n[split])
        if k <= 0:
            return
        i = n[split]
        Xb[split][i:i + k] = np.asarray(xs[:k])
        y[split][i:i + k] = ys[:k]
        rb[split][i:i + k] = rbs[:k]
        ply_arr[split][i:i + k] = plies[:k]
        if split in L:
            L[split][i:i + k] = np.asarray(Ls[:k])
            nl[split][i:i + k] = nls[:k]
        n[split] += k

    pool = mp.Pool(workers) if workers > 0 else None
    pending: collections.deque = collections.deque()
    max_pending = max(1, workers) * 64
    try:
        with _Source(src) as fh:
            for h, text in _games(fh):
                if not any(n[s] < caps[s] for s in caps):
                    break
                games_read += 1
                split = wanted_split(h)
                if split is None:
                    continue
                key = f"{seed}:{h.get('Site', '')}:{h['White']}:{h['Black']}:{h.get('UTCDate', '')}:{h.get('UTCTime', '')}"
                job = (text, int(h["WhiteElo"]), int(h["BlackElo"]),
                       int(hashlib.md5(key.encode()).hexdigest()[:16], 16), split in L,
                       min_ply, sample_prob, high_elo_boost, high_elo_min)
                if pool is None:
                    commit(split, _encode_game(job))
                    continue
                pending.append((split, pool.apply_async(_encode_game, (job,))))
                while len(pending) >= max_pending or (pending and pending[0][1].ready()):
                    s, r = pending.popleft()
                    commit(s, r.get())
                if games_read % 200_000 == 0:
                    print(f"games={games_read:,} counts={n} {time.perf_counter() - t0:.0f}s", flush=True)
            while pending:
                s, r = pending.popleft()
                commit(s, r.get())
    finally:
        if pool is not None:
            pool.terminate()

    for s in caps:
        k = n[s]
        np.save(os.path.join(out_dir, f"Xb_{s}.npy"), Xb[s][:k])
        np.save(os.path.join(out_dir, f"y_{s}.npy"), y[s][:k])
        np.save(os.path.join(out_dir, f"rb_{s}.npy"), rb[s][:k])
        np.save(os.path.join(out_dir, f"ply_{s}.npy"), ply_arr[s][:k])
        if s in L:
            np.save(os.path.join(out_dir, f"L_{s}.npy"), L[s][:k])
            np.save(os.path.join(out_dir, f"nlegal_{s}.npy"), nl[s][:k])
    month = pgn_path if re.fullmatch(r"\d{4}-\d{2}", pgn_path) else None
    bucket_counts = {s: {int(b): int(c) for b, c in zip(*np.unique(rb[s][:n[s]], return_counts=True))}
                     for s in caps}
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump({"counts": n, "caps": caps, "source": os.path.basename(src), "month": month,
                   "url": src if src.startswith("http") else None, "games_read": games_read,
                   "min_ply": min_ply, "sample_prob": sample_prob, "seed": seed,
                   "min_base_seconds": min_base_seconds, "high_elo_boost": high_elo_boost,
                   "high_elo_min": high_elo_min, "bucket_counts": bucket_counts,
                   "seconds": round(time.perf_counter() - t0, 1)}, f, indent=2)


def load_X(data_dir: str, split: str, packed: bool = False) -> np.ndarray:
    """Board features for a split: (n, 772) uint8, or (n, 97) bit-packed if packed=True.
    Reads the packed format, falling back to the older unpacked X_<split>.npy."""
    pb = os.path.join(data_dir, f"Xb_{split}.npy")
    if os.path.exists(pb):
        Xb = np.load(pb)
        return Xb if packed else np.unpackbits(Xb, axis=1)[:, :N_FEATURES]
    X = np.load(os.path.join(data_dir, f"X_{split}.npy"))
    return np.packbits(X, axis=1) if packed else X


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn", help="local .pgn/.pgn.zst, a URL, or a Lichess month like 2026-10 (streamed)")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--train", type=int, default=DEFAULT_CAPS["train"])
    ap.add_argument("--val", type=int, default=DEFAULT_CAPS["val"])
    ap.add_argument("--test", type=int, default=DEFAULT_CAPS["test"])
    ap.add_argument("--sample-prob", type=float, default=0.33)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-ply", type=int, default=10)
    ap.add_argument("--min-base-seconds", type=int, default=180)
    ap.add_argument("--high-elo-boost", type=float, default=1.0,
                    help="multiply sample-prob for movers rated >= --high-elo-min")
    ap.add_argument("--high-elo-min", type=int, default=2200)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = ap.parse_args()
    build(args.pgn, args.out, caps={"train": args.train, "val": args.val, "test": args.test},
          min_ply=args.min_ply, sample_prob=args.sample_prob, seed=args.seed,
          min_base_seconds=args.min_base_seconds, high_elo_boost=args.high_elo_boost,
          high_elo_min=args.high_elo_min, workers=args.workers)
