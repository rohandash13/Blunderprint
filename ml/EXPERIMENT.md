# October move model

The shipped candidate is the saved epoch-3 CNN, not a completed six-epoch run. Training was deliberately stopped after epoch 3; the checkpoint contains weights but no optimizer state. Its `epochs: 6` field records the planned schedule, while `best_epoch: 3` records the actual saved epoch. The three validation scores were 38.57%, 42.94%, and 44.325%. The selected checkpoint already clears the target, so no restart or test-driven tuning was performed.

`results/model_eval.json` compares the deployed January-2016 MLP, an October-2026 retrained MLP, and this CNN on the same fixed 50,000-position October test split. The CNN scores 43.85%, compared with 35.206% and 26.282%; uniform legal play scores 6.784%. The CNN wins all ten rating buckets, including 33.04% versus 27.50% and 21.09% in the highest bucket. The old 27.1% result was measured on a different test month and is not the baseline for this comparison.

The model uses six residual blocks, 64 channels, a 32-plane policy head, and a 16-dimensional rating embedding. Checkpoint weights are stored in fp16; serving loads fp32. Evaluation records the model type, config, checkpoint SHA-256, train arguments (including seed and saved epoch), parameter count, full dataset metadata and per-bucket results. BatchNorm running statistics are excluded from parameter counts.

## Reproduce

Run from this worktree's `ml/` directory with `PYTHONPATH=src`; the main checkout's editable install points at different source code. In PowerShell, use `$env:PYTHONPATH='src'` before invoking the selected Python executable. The main checkout's `.venv` is CPU-only. CUDA was verified on the RTX 3050 using torch 2.7.1+cu118; the newer cu126 build does not work with this laptop's driver.

```bash
PYTHONPATH=src python -m blunderprint_ml.data 2026-10 --out data/lichess_2026-10 --train 5000000 --val 20000 --test 50000 --sample-prob 0.15 --high-elo-boost 4 --workers 14
PYTHONPATH=src python -m blunderprint_ml.train --model mlp --data data/lichess_2026-10 --out checkpoints/mlp_2026.pt --epochs 6 --lr 1e-3 --schedule cosine
PYTHONPATH=src python -m blunderprint_ml.train --model cnn --data data/lichess_2026-10 --out checkpoints/cnn.pt --epochs 6 --lr 2e-3 --schedule cosine --half-weights
PYTHONPATH=src python -m blunderprint_ml.evaluate --data data/lichess_2026-10 --ckpt mlp_2016=checkpoints/mlp.pt --ckpt mlp_2026=checkpoints/mlp_2026.pt --ckpt cnn=checkpoints/cnn.pt --out ../results/model_eval.json
PYTHONPATH=src python -m pytest -q
```

The CNN command describes the original planned run; rerunning it to completion may select different weights from the committed epoch-3 checkpoint. Do not overwrite the candidate if preserving these exact results. Data generation preserves the player-hash split, minimum ply 10, base-time floor 180 seconds, and seed 0. Only games whose two players belong to the same hash split are accepted. Dataset metadata records the source month and URL. The local dataset and retrained MLP are gitignored; keep the worktree until they have been backed up if needed.

## Serving validation

`/analyze`, `p_moves_batch`, and `p_played_and_best_batch` retain their interfaces. API tests exercise both MLP and CNN checkpoints. Docker selects `checkpoints/cnn.pt`; the service's fallback remains the MLP for existing callers.

From the repository root:

```bash
docker build -t blunderprint-cnn-review -f ml/Dockerfile ml
docker run -d --name blunderprint-cnn-memory -m 512m -p 18000:8000 blunderprint-cnn-review
curl -H 'Content-Type: application/json' -d '{"moves":[{"id":1,"fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","rating":1500,"played_uci":"e2e4","best_uci":"d2d4","cpl":0}]}' http://localhost:18000/analyze
docker stats --no-stream blunderprint-cnn-memory
docker exec blunderprint-cnn-memory cat /sys/fs/cgroup/memory.peak
```

Measured on Docker Desktop's Linux VM: 219.9 MiB after the single-move request, and 257.9 MiB after a subsequent 256-move request (the backend's scoring batch size). Both returned all responses without an OOM. `results/model_memory.json` records the image, checkpoint hash, limit, cgroup peak and final Docker stats. These are sequential requests, not a concurrency stress test.

## Rollout requires rescoring

Do not merge without reviewing the model swap: changing `p_played` and `p_best` changes the habit filter (`min-p-played=0.15`) and therefore existing player reports. Existing runs need `POST /admin/players/{username}/rescore` against a local backend configured for the intended database. The public service blocks `/admin`; rescoring Neon needs a separately arranged step. No production database was accessed or rescored during this work.
