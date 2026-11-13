import numpy as np
import torch

import chess

from blunderprint_ml.encoding import encode_board
from blunderprint_ml.models import MLP, LinearModel, ResCNN, load_checkpoint, masked_top1
from blunderprint_ml.train import train, unpack_bits


def test_forward_shapes():
    x = torch.zeros(3, 772, dtype=torch.uint8)
    rb = torch.tensor([0, 3, 9])
    assert LinearModel()(x, rb).shape == (3, 4096)
    assert MLP(hidden=32)(x, rb).shape == (3, 4096)
    assert ResCNN(blocks=2, ch=16, head_ch=8)(x, rb).shape == (3, 4096)


def test_masked_top1_only_considers_legal_moves():
    logits = torch.zeros(1, 4096)
    logits[0, 5] = 10.0          # illegal but highest
    logits[0, 7] = 1.0           # legal
    mask = np.zeros((1, 4096), dtype=bool)
    mask[0, 7] = True
    packed = torch.from_numpy(np.packbits(mask, axis=1))
    assert masked_top1(logits, packed, torch.tensor([7])).tolist() == [True]


def _tiny_dataset(path, n=2048, seed=0):
    rng = np.random.default_rng(seed)
    path.mkdir(parents=True, exist_ok=True)
    for split, k in (("train", n), ("val", 64), ("test", 64)):
        X = (rng.random((k, 772)) < 0.05).astype(np.uint8)
        X[:, :8] = (rng.random((k, 8)) < 0.5).astype(np.uint8)
        y = (X[:, 0] + 2 * X[:, 1]).astype(np.int16)              # 4 balanced classes, learnable from 2 features
        np.save(path / f"X_{split}.npy", X)
        np.save(path / f"y_{split}.npy", y)
        np.save(path / f"rb_{split}.npy", rng.integers(0, 10, k).astype(np.uint8))
        if split != "train":
            mask = np.zeros((k, 4096), dtype=bool)
            mask[:, :4] = True
            np.save(path / f"L_{split}.npy", np.packbits(mask, axis=1))


def test_training_improves_and_checkpoint_roundtrips(tmp_path):
    _tiny_dataset(tmp_path / "d")
    hist = train("mlp", str(tmp_path / "d"), str(tmp_path / "m.pt"), epochs=8, batch=64, lr=3e-3, hidden=64)
    assert hist["val_top1"][-1] >= hist["val_top1"][0]
    assert hist["val_top1"][-1] > 0.5           # well above 1/4 chance over the 4 balanced classes
    model = load_checkpoint(str(tmp_path / "m.pt"))
    out = model(torch.zeros(2, 772, dtype=torch.uint8), torch.tensor([1, 2]))
    assert out.shape == (2, 4096)


def test_cnn_planes_put_pieces_on_their_squares():
    x = torch.from_numpy(encode_board(chess.Board())).unsqueeze(0)
    planes = x[:, :768].view(1, 12, 8, 8)
    assert planes[0, 5, 0, 4] == 1          # white king (plane 5) on e1 = rank 0, file 4
    assert planes[0, 0, 1].sum() == 8       # eight white pawns on rank 2
    assert planes[0, 10, 7, 3] == 1         # black queen (plane 6 + 4) on d8


def test_unpack_bits_matches_numpy():
    X = (np.random.default_rng(0).random((5, 772)) < 0.1).astype(np.uint8)
    packed = torch.from_numpy(np.packbits(X, axis=1))
    assert torch.equal(unpack_bits(packed), torch.from_numpy(X))


def test_cnn_trains_and_fp16_checkpoint_roundtrips(tmp_path):
    _tiny_dataset(tmp_path / "d")
    hist = train("cnn", str(tmp_path / "d"), str(tmp_path / "c.pt"), epochs=6, batch=64, lr=3e-3,
                 blocks=1, ch=16, head_ch=8, device="cpu", half_weights=True)
    assert hist["val_top1"][-1] > 0.5
    ck = torch.load(tmp_path / "c.pt", weights_only=True)
    assert ck["state_dict"]["head.4.weight"].dtype == torch.float16
    model = load_checkpoint(str(tmp_path / "c.pt"))
    assert next(model.parameters()).dtype == torch.float32
    assert model(torch.zeros(2, 772, dtype=torch.uint8), torch.tensor([1, 2])).shape == (2, 4096)
