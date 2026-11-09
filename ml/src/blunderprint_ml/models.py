import numpy as np
import torch
import torch.nn as nn

from .encoding import N_BUCKETS, N_FEATURES, N_MOVES


class LinearModel(nn.Module):
    def __init__(self, n_buckets: int = N_BUCKETS, emb: int = 16):
        super().__init__()
        self.emb = nn.Embedding(n_buckets, emb)
        self.out = nn.Linear(N_FEATURES + emb, N_MOVES)

    def forward(self, x, rb):
        return self.out(torch.cat([x.float(), self.emb(rb)], dim=1))


class MLP(nn.Module):
    def __init__(self, hidden: int = 1024, n_buckets: int = N_BUCKETS, emb: int = 16):
        super().__init__()
        self.emb = nn.Embedding(n_buckets, emb)
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES + emb, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, N_MOVES),
        )

    def forward(self, x, rb):
        return self.net(torch.cat([x.float(), self.emb(rb)], dim=1))


def build_model(name: str, **config) -> nn.Module:
    if name == "linear":
        return LinearModel()
    if name == "mlp":
        return MLP(hidden=config.get("hidden", 1024))
    raise ValueError(name)


def masked_top1(logits: torch.Tensor, packed_mask: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    mask = np.unpackbits(packed_mask.cpu().numpy(), axis=1)[:, :N_MOVES].astype(bool)
    masked = logits.masked_fill(~torch.from_numpy(mask).to(logits.device), float("-inf"))
    return masked.argmax(dim=1) == y


def model_from_checkpoint(ck: dict) -> nn.Module:
    """Build an eval-mode model from an already-loaded checkpoint dict."""
    model = build_model(ck["model"], **ck["config"])
    model.load_state_dict(ck["state_dict"])
    model.eval()
    return model


def load_checkpoint(path: str) -> nn.Module:
    return model_from_checkpoint(torch.load(path, map_location="cpu", weights_only=True))
