"""Measure analysis throughput at several worker counts and the warm-cache hit rate.

Usage (from the repo root, with the backend and Postgres running):
    python scripts/loadtest.py --username SOME_LICHESS_USER --games 40 --depth 12
"""
import argparse
import json
import os
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import psycopg2  # noqa: E402
import requests  # noqa: E402

BASE = "http://localhost:8080"


def wait_until_done(run_id: str, timeout: int = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        p = requests.get(f"{BASE}/analysis/{run_id}").json()
        if p["doneFens"] + p["failedFens"] >= p["totalFens"]:
            return p
        time.sleep(0.5)
    raise TimeoutError("analysis did not finish")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--games", type=int, default=40)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--workers", type=int, nargs="+", default=[1, 2, 4, 8])
    ap.add_argument("--out", default="results/loadtest")
    args = ap.parse_args()

    db = psycopg2.connect(host="localhost", dbname="blunderprint", user="chess", password="chess")
    db.autocommit = True

    requests.post(f"{BASE}/admin/workers", json={"count": 0})
    first = requests.post(f"{BASE}/analysis", json={
        "username": args.username, "maxGames": args.games, "depth": args.depth}).json()
    run_id = first["runId"]
    print(f"run {run_id}: {first['moves']} moves from {first['games']} games")

    results = []
    for n in args.workers:
        with db.cursor() as cur:
            cur.execute("truncate eval_cache, eval_job")
        requests.post(f"{BASE}/admin/workers", json={"count": 0})
        requests.post(f"{BASE}/analysis/{run_id}/reenqueue")
        t0 = time.time()
        requests.post(f"{BASE}/admin/workers", json={"count": n})
        prog = wait_until_done(run_id)
        secs = time.time() - t0
        row = {"workers": n, "seconds": round(secs, 2), "fens": prog["doneFens"],
               "fens_per_sec": round(prog["doneFens"] / secs, 2)}
        print(row)
        results.append(row)

    # Warm cache: same player again without truncating.
    again = requests.post(f"{BASE}/analysis", json={
        "username": args.username, "maxGames": args.games, "depth": args.depth}).json()
    t0 = time.time()
    prog = wait_until_done(again["runId"])
    warm = {"enqueued": again["jobsEnqueued"], "total": prog["totalFens"],
            "cache_hit_rate": round(1 - again["jobsEnqueued"] / max(prog["totalFens"], 1), 4),
            "seconds": round(time.time() - t0, 2)}
    print("warm:", warm)

    out = {"username": args.username, "games": args.games, "depth": args.depth,
           "cpu_count": os.cpu_count(), "scaling": results, "warm_cache": warm}
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out + ".json", "w") as f:
        json.dump(out, f, indent=2)

    plt.figure(figsize=(5, 3.5))
    plt.plot([r["workers"] for r in results], [r["fens_per_sec"] for r in results], marker="o")
    plt.xlabel("Stockfish workers")
    plt.ylabel("positions / second")
    plt.title(f"Analysis throughput (depth {args.depth}, {os.cpu_count()} CPUs)")
    plt.tight_layout()
    plt.savefig(args.out + ".png", dpi=150)


if __name__ == "__main__":
    main()
