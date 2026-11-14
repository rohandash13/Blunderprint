"""Break a player's candidate mistakes down by challenge level (slip / tricky / deep / unrated).

Usage (repo root, backend running, latest run rescored so difficulty_elo is filled in):
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


PATTERN_PRIORITY = ["time_trouble", "missed_tactic", "hanging_piece", "positional", "endgame_technique", "opening_error"]


def primary_pattern(tags: list[str] | None) -> str:
    for t in PATTERN_PRIORITY:
        if t in (tags or []):
            return t
    return "other"


def summarize(rows: list[dict]) -> dict:
    """Candidates are the rows with a level (the backend sets level only for candidates)."""
    cands = [r for r in rows if r.get("level") is not None]
    total = len(cands)
    out = {"candidates": total, "levels": {}}
    for level in LEVELS:
        sel = [r for r in cands if r["level"] == level]
        kinds = Counter(r.get("kind") or "unknown" for r in sel)
        patterns = Counter(primary_pattern(r.get("tags")) for r in sel)
        drops = [r["winDrop"] for r in sel if r.get("winDrop") is not None]
        out["levels"][level] = {
            "count": len(sel),
            "share": round(len(sel) / total, 4) if total else 0.0,
            "avg_win_drop": round(sum(drops) / len(drops), 4) if drops else None,
            "by_kind": dict(kinds.most_common()),
            "by_pattern": dict(patterns.most_common()),
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--base-url", default=BASE, help="backend or frontend API origin")
    ap.add_argument("--out", default=os.path.join("results", "difficulty_levels.json"))
    args = ap.parse_args()
    response = requests.get(f"{args.base_url.rstrip('/')}/players/{urllib.parse.quote(args.username, safe='')}/mistakes", timeout=60)
    response.raise_for_status()
    result = {"username": args.username, "base_url": args.base_url.rstrip('/'), **summarize(response.json())}
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    for level in LEVELS:
        s = result["levels"][level]
        print(f"{level:8s} {s['count']:5d}  {s['share']:6.1%}  avg win drop {s['avg_win_drop']}  kinds {s['by_kind']}")


if __name__ == "__main__":
    main()
