"""Evaluate baselines and trained models on the held-out test split (player-disjoint)."""
import json
import os

import numpy as np
import torch

from .models import load_checkpoint, masked_top1


def evaluate(data_dir: str, checkpoints: dict[str, str], out_path: str) -> dict:
    X = torch.from_numpy(np.load(os.path.join(data_dir, "X_test.npy")))
    y = torch.from_numpy(np.load(os.path.join(data_dir, "y_test.npy")).astype(np.int64))
    rb = torch.from_numpy(np.load(os.path.join(data_dir, "rb_test.npy")).astype(np.int64))
    L = torch.from_numpy(np.load(os.path.join(data_dir, "L_test.npy")))
    nlegal = np.load(os.path.join(data_dir, "nlegal_test.npy"))

    def summarize(correct: np.ndarray) -> dict:
        by_bucket = {int(b): float(correct[rb.numpy() == b].mean()) for b in np.unique(rb.numpy())}
        return {"top1": float(correct.mean()), "by_bucket": by_bucket}

    results = {"n_test": int(len(y))}
    uniform = 1.0 / nlegal
    results["uniform"] = {"top1": float(uniform.mean()),
                          "by_bucket": {int(b): float(uniform[rb.numpy() == b].mean())
                                        for b in np.unique(rb.numpy())}}
    for name, path in checkpoints.items():
        model = load_checkpoint(path)
        correct = []
        with torch.no_grad():
            for i in range(0, len(y), 4096):
                sl = slice(i, i + 4096)
                correct.append(masked_top1(model(X[sl], rb[sl]), L[sl], y[sl]).numpy())
        results[name] = summarize(np.concatenate(correct))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    return results


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed")
    ap.add_argument("--linear", default="checkpoints/linear.pt")
    ap.add_argument("--mlp", default="checkpoints/mlp.pt")
    ap.add_argument("--out", default="../results/model_eval.json")
    args = ap.parse_args()
    r = evaluate(args.data, {"linear": args.linear, "mlp": args.mlp}, args.out)
    print(json.dumps({k: (v["top1"] if isinstance(v, dict) else v) for k, v in r.items()}, indent=2))
