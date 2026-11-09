"""Profile dataset building on a small slice to decide whether a Rust encoder is justified.

Usage (from repo root): python scripts/profile_encode.py ml/data/<dump>.pgn.zst
"""
import cProfile
import pstats
import sys
import tempfile

sys.path.insert(0, "ml/src")
from blunderprint_ml.data import build  # noqa: E402


def main(pgn: str) -> None:
    prof = cProfile.Profile()
    with tempfile.TemporaryDirectory() as out:
        prof.enable()
        build(pgn, out, caps={"train": 20_000, "val": 0, "test": 0}, sample_prob=0.33)
        prof.disable()
    stats = pstats.Stats(prof)
    total = stats.total_tt
    encode = sum(v[3] for k, v in stats.stats.items() if k[2] == "encode_board")   # cumulative time
    frac = encode / total
    report = f"total={total:.1f}s encode_board_cumulative={encode:.1f}s fraction={frac:.2f}\n"
    report += "GATE: build the Rust encoder (Task 21)\n" if frac > 0.40 else "GATE: skip Rust; profile shows encoding is not the bottleneck\n"
    print(report)
    with open("results/profile_encode.txt", "w") as f:
        f.write(report)


if __name__ == "__main__":
    main(sys.argv[1])
