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


class _ResBlock(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b2 = nn.BatchNorm2d(ch)

    def forward(self, x):
        h = torch.relu(self.b1(self.c1(x)))
        return torch.relu(x + self.b2(self.c2(h)))


class ResCNN(nn.Module):
    """Residual CNN over 8x8 planes: 12 piece planes + 4 castling planes + the rating embedding broadcast
    as `emb` constant planes. Takes the same 772-feature input as the MLP, so inference is unchanged.
    Policy head: 1x1 conv to `head_ch` planes, flatten, linear to the 4096 from-to moves."""

    def __init__(self, blocks: int = 6, ch: int = 64, head_ch: int = 32, n_buckets: int = N_BUCKETS,
                 emb: int = 16):
        super().__init__()
        self.emb = nn.Embedding(n_buckets, emb)
        self.stem = nn.Sequential(nn.Conv2d(12 + 4 + emb, ch, 3, padding=1, bias=False),
                                  nn.BatchNorm2d(ch), nn.ReLU())
        self.tower = nn.Sequential(*[_ResBlock(ch) for _ in range(blocks)])
        self.head = nn.Sequential(nn.Conv2d(ch, head_ch, 1, bias=False), nn.BatchNorm2d(head_ch), nn.ReLU(),
                                  nn.Flatten(), nn.Linear(head_ch * 64, N_MOVES))

    def forward(self, x, rb):
        x = x.float()
        n = x.shape[0]
        pieces = x[:, :768].view(n, 12, 8, 8)          # plane*64 + square, square = rank*8 + file
        castle = x[:, 768:772, None, None].expand(n, 4, 8, 8)
        rating = self.emb(rb)[:, :, None, None].expand(n, -1, 8, 8)
        h = self.tower(self.stem(torch.cat([pieces, castle, rating], dim=1)))
        return self.head(h)


def build_model(name: str, **config) -> nn.Module:
    if name == "linear":
        return LinearModel()
    if name == "mlp":
        return MLP(hidden=config.get("hidden", 1024))
    if name == "cnn":
        return ResCNN(blocks=config.get("blocks", 6), ch=config.get("ch", 64),
                      head_ch=config.get("head_ch", 32))
    raise ValueError(name)


def masked_top1(logits: torch.Tensor, packed_mask: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    mask = np.unpackbits(packed_mask.cpu().numpy(), axis=1)[:, :N_MOVES].astype(bool)
    masked = logits.masked_fill(~torch.from_numpy(mask).to(logits.device), float("-inf"))
    return masked.argmax(dim=1) == y


def model_from_checkpoint(ck: dict) -> nn.Module:
    """Build an eval-mode model from an already-loaded checkpoint dict."""
    model = build_model(ck["model"], **ck["config"])
    # Checkpoints may store weights in fp16 to halve their size; inference always runs in fp32.
    model.load_state_dict({k: v.float() if v.is_floating_point() else v for k, v in ck["state_dict"].items()})
    model.eval()
    return model


def load_checkpoint(path: str) -> nn.Module:
    return model_from_checkpoint(torch.load(path, map_location="cpu", weights_only=True))
