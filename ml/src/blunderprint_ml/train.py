import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from .data import load_X
from .encoding import N_FEATURES
from .models import build_model, masked_top1

_SHIFTS = torch.arange(7, -1, -1, dtype=torch.uint8)


def unpack_bits(packed: torch.Tensor) -> torch.Tensor:
    """(n, 97) bit-packed uint8 (numpy packbits order) -> (n, 772) uint8, on packed's device."""
    bits = (packed.unsqueeze(-1) >> _SHIFTS.to(packed.device)) & 1
    return bits.flatten(1)[:, :N_FEATURES]


def _load(data_dir, split, with_mask, device):
    d = lambda n: np.load(os.path.join(data_dir, f"{n}_{split}.npy"))
    out = {"Xb": torch.from_numpy(load_X(data_dir, split, packed=True)).to(device),
           "y": torch.from_numpy(d("y").astype(np.int64)).to(device),
           "rb": torch.from_numpy(d("rb").astype(np.int64)).to(device)}
    if with_mask:
        out["L"] = torch.from_numpy(d("L"))
    return out


@torch.no_grad()
def _val_top1(model, data, batch=4096):
    model.eval()
    correct = 0
    for i in range(0, len(data["y"]), batch):
        sl = slice(i, i + batch)
        logits = model(unpack_bits(data["Xb"][sl]), data["rb"][sl]).float()
        correct += masked_top1(logits, data["L"][sl], data["y"][sl]).sum().item()
    return correct / max(len(data["y"]), 1)


def _model_config(model_name, hidden, blocks, ch, head_ch):
    if model_name == "mlp":
        return {"hidden": hidden}
    if model_name == "cnn":
        return {"blocks": blocks, "ch": ch, "head_ch": head_ch}
    return {}


def train(model_name, data_dir, out_path, epochs=5, batch=1024, lr=1e-3, seed=0, hidden=1024,
          blocks=6, ch=64, head_ch=32, weight_decay=0.01, schedule="constant", device=None,
          half_weights=False):
    """Train on data_dir's train split, keep the checkpoint with the best val top-1.
    schedule='cosine' uses one-cycle warmup + cosine decay; half_weights saves fp16 weights."""
    torch.manual_seed(seed)
    device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    tr, va = _load(data_dir, "train", False, device), _load(data_dir, "val", True, device)
    config = _model_config(model_name, hidden, blocks, ch, head_ch)
    model = build_model(model_name, **config).to(device)
    if device.type == "cuda" and model_name == "cnn":
        model = model.to(memory_format=torch.channels_last)   # ~35% faster convs on Ampere
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    n = len(tr["y"])
    steps = epochs * ((n + batch - 1) // batch)
    sched = (torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.05)
             if schedule == "cosine" else None)
    amp = device.type == "cuda"
    meta_path = os.path.join(data_dir, "meta.json")
    data_meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    hist = {"train_loss": [], "val_top1": [], "epoch_seconds": []}
    best = -1.0
    for epoch in range(epochs):
        t0 = time.perf_counter()
        model.train()
        perm = torch.randperm(n, device=device)
        total = torch.zeros((), device=device)
        for i in range(0, n, batch):
            idx = perm[i:i + batch]
            with torch.autocast(device.type, dtype=torch.bfloat16, enabled=amp):
                logits = model(unpack_bits(tr["Xb"][idx]), tr["rb"][idx])
            loss = F.cross_entropy(logits.float(), tr["y"][idx])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            if sched is not None:
                sched.step()
            total += loss.detach() * len(idx)
        acc = _val_top1(model, va)
        secs = time.perf_counter() - t0
        hist["train_loss"].append(total.item() / n)
        hist["val_top1"].append(acc)
        hist["epoch_seconds"].append(round(secs, 1))
        print(f"epoch {epoch + 1}/{epochs} loss={total.item() / n:.4f} val_top1={acc:.4f} ({secs:.0f}s)",
              flush=True)
        if acc > best:
            best = acc
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            state = {k: (v.half() if half_weights and v.is_floating_point() else v).cpu().contiguous()
                     for k, v in model.state_dict().items()}
            torch.save({"model": model_name, "state_dict": state, "config": config,
                        "train_args": {"epochs": epochs, "batch": batch, "lr": lr, "seed": seed,
                                       "weight_decay": weight_decay, "schedule": schedule,
                                       "half_weights": half_weights, "best_epoch": epoch + 1,
                                       "best_val_top1": acc, "n_train": n, "data_dir": data_dir,
                                       "data_source": data_meta.get("source"),
                                       "data_month": data_meta.get("month")}}, out_path)
    return hist


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["linear", "mlp", "cnn"], required=True)
    ap.add_argument("--data", default="data/processed")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--schedule", choices=["constant", "cosine"], default="constant")
    ap.add_argument("--hidden", type=int, default=1024, help="MLP hidden width")
    ap.add_argument("--blocks", type=int, default=6, help="CNN residual blocks")
    ap.add_argument("--ch", type=int, default=64, help="CNN filters")
    ap.add_argument("--head-ch", type=int, default=32, help="CNN policy-head planes")
    ap.add_argument("--half-weights", action="store_true", help="save fp16 weights (half the file size)")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()
    hist = train(args.model, args.data, args.out, args.epochs, args.batch, args.lr, args.seed,
                 hidden=args.hidden, blocks=args.blocks, ch=args.ch, head_ch=args.head_ch,
                 weight_decay=args.weight_decay, schedule=args.schedule, device=args.device,
                 half_weights=args.half_weights)
    print(hist)
