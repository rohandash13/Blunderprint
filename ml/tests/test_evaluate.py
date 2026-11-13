import json

import numpy as np
import torch

from blunderprint_ml.evaluate import evaluate
from blunderprint_ml.models import MLP, LinearModel, ResCNN
from test_models import _tiny_dataset


def test_evaluate_writes_baseline_and_model_results(tmp_path):
    data = tmp_path / "d"
    _tiny_dataset(data)
    nlegal = np.random.default_rng(1).integers(2, 40, 64).astype(np.int16)
    np.save(data / "nlegal_test.npy", nlegal)
    (data / "meta.json").write_text(json.dumps({"source": "tiny"}))

    torch.manual_seed(0)
    torch.save({"model": "linear", "state_dict": LinearModel().state_dict(), "config": {},
                "train_args": {"epochs": 0}}, tmp_path / "linear.pt")
    torch.save({"model": "mlp", "state_dict": MLP(hidden=16).state_dict(), "config": {"hidden": 16},
                "train_args": {"epochs": 0}}, tmp_path / "mlp.pt")
    cnn = ResCNN(blocks=1, ch=8, head_ch=4)
    torch.save({"model": "cnn", "state_dict": cnn.state_dict(),
                "config": {"blocks": 1, "ch": 8, "head_ch": 4}}, tmp_path / "cnn.pt")

    out = tmp_path / "out" / "eval.json"
    evaluate(str(data), {name: str(tmp_path / f"{name}.pt") for name in ("linear", "mlp", "cnn")}, str(out))
    res = json.loads(out.read_text())

    assert res["n_test"] == 64
    for key in ("uniform", "linear", "mlp", "cnn"):
        assert 0.0 <= res[key]["top1"] <= 1.0
        assert res[key]["by_bucket"]
    assert abs(res["uniform"]["top1"] - float(np.mean(1.0 / nlegal))) < 1e-9
    prov = res["provenance"]
    assert prov["dataset"] == {"source": "tiny"}
    assert set(prov["checkpoints"]) == {"linear", "mlp", "cnn"}
    assert prov["checkpoints"]["mlp"]["config"] == {"hidden": 16}
    assert prov["checkpoints"]["linear"]["train_args"] == {"epochs": 0}
    assert prov["checkpoints"]["mlp"]["model"] == "mlp"
    assert len(prov["checkpoints"]["mlp"]["sha256"]) == 64
    assert prov["checkpoints"]["cnn"]["n_params"] == sum(p.numel() for p in cnn.parameters())
