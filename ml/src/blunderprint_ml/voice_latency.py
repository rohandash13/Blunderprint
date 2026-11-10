"""Summarize exported voice-agent sessions into per-model latency percentiles.

Usage: python -m blunderprint_ml.voice_latency results/voice_sessions --out results/voice_latency.json
"""
import argparse
import json
import os
from collections import defaultdict

import numpy as np


def _pct(values: list[float]) -> dict:
    a = np.asarray(values, dtype=float)
    return {"p50": round(float(np.percentile(a, 50)), 4), "p95": round(float(np.percentile(a, 95)), 4), "n": int(a.size)}


def summarize(sessions: list[dict]) -> dict:
    metrics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    turns: dict[str, int] = defaultdict(int)
    calls: dict[str, int] = defaultdict(int)
    for s in sessions:
        model = s["model"]
        turns[model] += len(s.get("reports", []))
        calls[model] += len(s.get("functionCalls", []))
        for row in s.get("reports", []):
            for k, v in row.items():
                if k.endswith("_latency"):
                    metrics[model][k].append(float(v))
    out = {}
    for model in turns:
        out[model] = {"turns": turns[model], "function_calls": calls[model]}
        for k, vals in sorted(metrics[model].items()):
            out[model][k] = _pct(vals)
    return out


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser()
    ap.add_argument("sessions_dir")
    ap.add_argument("--out", default="results/voice_latency.json")
    args = ap.parse_args(argv)
    names = sorted(n for n in os.listdir(args.sessions_dir) if n.endswith(".json"))
    sessions = []
    for n in names:
        with open(os.path.join(args.sessions_dir, n)) as f:
            sessions.append(json.load(f))
    result = {"sessions": names, "models": summarize(sessions)}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result["models"], indent=2))
    return result


if __name__ == "__main__":
    main()
