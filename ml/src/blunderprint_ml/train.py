import os

import numpy as np
import torch
import torch.nn.functional as F

from .models import build_model, masked_top1


def _load(data_dir, split, with_mask):
    d = lambda n: np.load(os.path.join(data_dir, f"{n}_{split}.npy"))
    out = {"X": torch.from_numpy(d("X")), "y": torch.from_numpy(d("y").astype(np.int64)),
           "rb": torch.from_numpy(d("rb").astype(np.int64))}
    if with_mask:
        out["L"] = torch.from_numpy(d("L"))
    return out


@torch.no_grad()
def _val_top1(model, data, batch=4096):
    model.eval()
    correct = 0
    for i in range(0, len(data["y"]), batch):
        sl = slice(i, i + batch)
        logits = model(data["X"][sl], data["rb"][sl])
        correct += masked_top1(logits, data["L"][sl], data["y"][sl]).sum().item()
    return correct / max(len(data["y"]), 1)


def train(model_name, data_dir, out_path, epochs=5, batch=1024, lr=1e-3, seed=0, hidden=1024):
    torch.manual_seed(seed)
    tr, va = _load(data_dir, "train", False), _load(data_dir, "val", True)
    config = {"hidden": hidden} if model_name == "mlp" else {}
    model = build_model(model_name, **config)
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    n = len(tr["y"])
    hist = {"train_loss": [], "val_top1": []}
    best = -1.0
    for epoch in range(epochs):
        model.train()
        perm = torch.randperm(n)
        total = 0.0
        for i in range(0, n, batch):
            idx = perm[i:i + batch]
            logits = model(tr["X"][idx], tr["rb"][idx])
            loss = F.cross_entropy(logits, tr["y"][idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
        acc = _val_top1(model, va)
        hist["train_loss"].append(total / n)
        hist["val_top1"].append(acc)
        print(f"epoch {epoch + 1}/{epochs} loss={total / n:.4f} val_top1={acc:.4f}")
        if acc > best:
            best = acc
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            torch.save({"model": model_name, "state_dict": model.state_dict(), "config": config}, out_path)
    return hist


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["linear", "mlp"], required=True)
    ap.add_argument("--data", default="data/processed")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args()
    train(args.model, args.data, args.out, args.epochs, args.batch, args.lr)
