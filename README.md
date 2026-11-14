# Blunderprint

**[Try the app](https://useblunderprint.vercel.app)** · **[Watch the demo](https://github.com/rohandash13/Blunderprint/releases/download/demo-v2/blunderprint-demo-v2.mp4)** · [Training and evaluation](ml/EXPERIMENT.md)

Finds the chess mistakes a player keeps repeating, then coaches them through those positions by voice.

Give it a Lichess username. It downloads the player's games, runs every position through Stockfish, scores each
mistake with a neural network trained on how players at that rating actually move, groups the mistakes into
patterns (hanging pieces, missed tactics, endgame technique, ...), and opens a voice coach that drills the player
on their own positions.

The coach opens with **Profile → Choose focus → Drill**. The Club Wallchart shows patterns across recent games;
click a mark to replay that position, or choose a pattern to practice. Click a piece to see legal destinations, drag pieces, type a move, or use voice. Ask where an attempt went wrong to review it on the board and try again. Engine lines advance one move at a time,
with a caption for each move. New usernames can be analyzed on the public demo within its queue and daily limits.

## See it in action

[![Watch Blunderprint: a spoken move, an explained reply, and another try](docs/demo/preview.jpg)](https://github.com/rohandash13/Blunderprint/releases/download/demo-v2/blunderprint-demo-v2.mp4)

The demo uses my recorded voice to ask the live coach questions, with the app's actual spoken responses and board actions. A wrong attempt stops immediately; “Why is that wrong?” opens the review, “Show me the reply” explains a single reply, and “Let me try again” returns with the answer hidden.

**Try that workflow:** open the app in Chrome, choose **Try Knight_ofthelight73 → Drill this pattern → Start voice**, and allow microphone access. You can speak, drag pieces, click legal destinations, or type. Time trouble adds a decision clock. [Demo details and download](docs/demo/README.md).

The visual system and responsive behavior are documented in [DESIGN.md](DESIGN.md), with
[desktop and phone review captures](docs/design/reviews/2026-11-13-coach-ui-v3.md).

## Architecture

```mermaid
flowchart LR
    Player[Player] --> UI[React + TypeScript<br/>Vercel]
    UI <-->|Reports, analysis, engine requests| API[Spring Boot API<br/>Render]
    Lichess[Lichess games] --> API
    API <--> DB[(Neon Postgres<br/>Games, queue, cached evaluations)]
    API <--> Engine[Stockfish<br/>Move quality and continuations]
    API <-->|Batched move probabilities| Model[FastAPI + PyTorch CNN<br/>Private Render service · CPU]
    UI <-->|Speech and coaching tools| Voice[Deepgram Voice Agent]
    API -->|Short-lived voice token| UI
    Train[Offline PyTorch training<br/>NVIDIA GPU + CUDA] -. Saved checkpoint .-> Model
```

- **Analysis pipeline (Java).** Games are replayed into positions; each unique position becomes a job in a
  Postgres queue (`FOR UPDATE SKIP LOCKED`). A pool of Stockfish workers drains it and writes to a shared
  `eval_cache` keyed by position, engine version, depth and MultiPV, so repeated positions are never re-analyzed.
  Centipawn loss is computed per move once all evaluations are in.
- **Move model (Python).** A rating-conditioned residual CNN (board planes + rating embedding → from-to moves)
  predicts what a player at a given rating would play. A mistake the model rates as *likely* for the player's
  rating is a habit worth drilling, not a one-off.
- **Voice coach (React + Deepgram).** The browser talks to Deepgram's Voice Agent API directly with a short-lived
  token minted by the backend. The LLM never judges chess: client-side functions (`play_move`,
  `get_hint`, `explain_line`, `try_move`, ...) compute verdicts, hints and engine lines in code and hand the
  agent facts to narrate. Hints follow a ladder (idea → piece → square); the answer is revealed only when the
  player asks.
- **Difficulty, measured by the engine and judged against the player's rating.** Mistakes are graded by the drop
  in winning chances (the Lichess win-chance curve), so a quiet positional error counts and a 20-pawn swing in an
  already-won game doesn't dominate. For each repeatable mistake, one MultiPV-2 Stockfish search records the
  shallowest depth from which the engine stops changing its mind, whether the best move is the only good one, and
  whether it simply wins free material. That gives an estimated rating at which players usually find the move;
  levels compare it with the player's own rating (slip: they should see it; deep: a stretch). An earlier version
  used the move model's probability here and rated a free-queen capture as "deep" (the model gave it 0.3%); the
  engine trace puts it at about 900 Elo, a slip for a 2400 player. Each mistake belongs to one primary pattern,
  including a new **positional** pattern; clock errors support timed decision drills; and the coach describes difficulty in
  words ("a quiet positional move, the kind that's hard to find even at your level"), never percentages.
- **Guided practice.** Wrong attempts return to the original position for another try. **See why** reopens the attempted move; a separate request shows the first engine reply with an arrow, caption and spoken explanation. The app waits for narration playback and a new player request before advancing. Previous/Next, arrow keys and spoken navigation revisit shown positions. Habit summaries use plain speech and a bold, grouped list in the chat.

## Why CUDA?

The CNN is trained offline with **PyTorch and CUDA** on an NVIDIA GPU. Training repeatedly applies convolutions to batches of chessboards and computes gradients; the GPU runs that parallel tensor work efficiently. The training code selects CUDA when available, uses mixed-precision autocast and a channels-last layout for the CNN, and keeps board data packed until batch decoding. This is PyTorch using CUDA; the project does not implement custom CUDA kernels.

The network reads piece locations, castling rights and a learned rating embedding. Residual convolution blocks learn spatial patterns on the board, and a policy head scores origin/destination moves. At inference, illegal moves are masked out. Its job is to estimate **what a player at that rating is likely to play**. Stockfish separately determines move quality and better continuations.

The shipped checkpoint was saved after epoch **3** of a planned **6**-epoch run. Its architecture, saved epoch, dataset provenance and fair baseline comparison are recorded by the [evaluation script](ml/src/blunderprint_ml/evaluate.py) in [the evaluation results](results/model_eval.json). See [the experiment notes](ml/EXPERIMENT.md) for the compatible CUDA environment and reproduction commands.

**Production inference runs on CPU.** The deployed Docker image installs CPU-only PyTorch and loads the saved CNN; visitors do not need a GPU. CUDA helped train the model, while CPU serving keeps the private model service small. No GPU speedup benchmark is claimed.

## Results

Every number below is produced by a script in this repo; the output files are in `results/`.

| What | Result | Reproduce |
|------|--------|-----------|
| Move prediction, masked top-1 on 50K held-out positions from 2026-10 (player-disjoint split, 5M training positions) | **43.85% CNN** vs 35.21% retrained MLP vs 26.28% former MLP vs 6.78% uniform; CNN wins every rating bucket | `cd ml && python -m blunderprint_ml.evaluate --data data/lichess_2026-10 --ckpt mlp_2016=checkpoints/mlp.pt --ckpt mlp_2026=checkpoints/mlp_2026.pt --ckpt cnn=checkpoints/cnn.pt --out ../results/model_eval.json` → `results/model_eval.json`; rebuild/training commands in [ml/EXPERIMENT.md](ml/EXPERIMENT.md) |
| Analysis throughput, 30 games at depth 12 | **44 → 120 positions/sec** from 1 to 8 workers | `python scripts/loadtest.py` → `results/loadtest_batched.json` |
| Batched DB writes | database share of worker time **26% → 9%** | `results/loadtest_timing.json` vs `results/loadtest_batched.json` |
| Difficulty of the sample player's repeatable mistakes after CNN rescoring | **160** candidates: 85 slips, 33 tricky, 15 deep, 27 unrated | `python scripts/difficulty_report.py --username Knight_ofthelight73 --base-url https://useblunderprint.vercel.app` → `results/difficulty_levels.json` |

## Running locally

Requirements: Docker, JDK 21, Maven, Python 3.11+, Node 20+, a Stockfish binary, and a Deepgram API key with
the Member role (for voice).

```bash
docker compose up -d postgres
```

```bash
cp .env.example .env   # then set DEEPGRAM_API_KEY
```

Model service (port 8000):

```bash
cd ml && pip install -e ".[dev,train]" && MODEL_CKPT=checkpoints/cnn.pt uvicorn blunderprint_ml.service:app --port 8000
```

Backend (port 8080):

```bash
cd backend && STOCKFISH_PATH=/path/to/stockfish mvn spring-boot:run
```

Frontend (port 5173):

```bash
cd frontend && npm install && npm run dev
```

Analyze a player, then open http://localhost:5173, load their report and press **Start voice**:

```bash
curl -X POST localhost:8080/analysis -H "Content-Type: application/json" -d '{"username":"SOME_USER","maxGames":100}'
```

## Tests

```bash
cd backend && mvn test
```

```bash
cd ml && pytest
```

```bash
cd frontend && npm test
```

## Deployment

Vercel (React frontend, `frontend/`, rewrites `/players`, `/engine`, `/voice` to the API) -> Render web service
(Spring Boot + Stockfish, `backend/Dockerfile`) -> Render private service (PyTorch model, `ml/Dockerfile`) ->
Neon Postgres. `render.yaml` is the Blueprint for both Render services.

- Backend env: `DATABASE_URL` (Neon `postgresql://user:pass@host/db?sslmode=require`), `DEEPGRAM_API_KEY`,
  `MODEL_HOSTPORT` (set from the model service), `DEMO_MODE`, `WORKERS_COUNT`, `JAVA_OPTS`.
- `DEMO_MODE=true` blocks `/admin/**` and re-enqueue routes. Public `POST /analysis` is queued and rate-limited; `GET /voice/token` is rate-limited
  (`voice.rate.per-ip-per-hour`, default 20, and `voice.rate.per-day`, default 300).


## Layout

```
backend/   Spring Boot service: ingest, queue, Stockfish workers, scoring, reports, engine + voice endpoints
ml/        dataset builder, model training/evaluation, FastAPI inference service
frontend/  React voice coach
scripts/   load tests and profiling that produce results/
docs/      design specs and implementation plans
```
