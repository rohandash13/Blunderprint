"""Break a player's mistakes down by challenge level (slip / tricky / deep / unrated).

Usage (repo root, backend running, latest run rescored so p_best is filled in):
    python scripts/difficulty_report.py --username SOME_LICHESS_USER
"""
import argparse
import json
import os
import urllib.parse
from collections import Counter, defaultdict

import requests

BASE = "http://localhost:8080"
LEVELS = ["slip", "tricky", "deep", "unrated"]


def summarize(rows: list[dict], mistake_cpl: int, min_p_played: float = 0.15) -> dict:
    # Same base as the report's patterns and levelCounts: costly moves the model rates as likely for the player.
    mistakes = [r for r in rows if r["cpl"] >= mistake_cpl and (r.get("pPlayed") or 0.0) >= min_p_played]
    total = len(mistakes)
    out = {"mistakes": total, "mistake_cpl": mistake_cpl, "min_p_played": min_p_played, "levels": {}}
    for level in LEVELS:
        sel = [r for r in mistakes if (r.get("level") or "unrated") == level]
        tags = Counter(t for r in sel for t in (r["tags"] or ["untagged"]))
        out["levels"][level] = {
            "count": len(sel),
            "share": round(len(sel) / total, 4) if total else 0.0,
            "avg_cpl": round(sum(r["cpl"] for r in sel) / len(sel), 1) if sel else None,
            "by_tag": dict(tags.most_common()),
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--mistake-cpl", type=int, default=100)
    ap.add_argument("--min-p-played", type=float, default=0.15)
    ap.add_argument("--out", default=os.path.join("results", "difficulty_levels.json"))
    args = ap.parse_args()
    rows = requests.get(f"{BASE}/players/{urllib.parse.quote(args.username, safe='')}/mistakes", timeout=60).json()
    result = {"username": args.username, **summarize(rows, args.mistake_cpl, args.min_p_played)}
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    for level in LEVELS:
        s = result["levels"][level]
        print(f"{level:8s} {s['count']:5d}  {s['share']:6.1%}  avg cpl {s['avg_cpl']}")


if __name__ == "__main__":
    main()
